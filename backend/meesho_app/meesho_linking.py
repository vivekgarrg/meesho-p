"""
Meesho Orders → Order linking: link a shipment's AWB to its packet (the packet
QR, "KP…") at the packing desk.

A link is checked against what the sync knows of that AWB's packet (the Ready
to ship / Shipped tabs carry each shipment's AWB, packet id and courier id),
then sent to Meesho — the panel's own Scan now → link request — straight from
here with the account's saved session, so the desk hears back at once. Only
when Meesho links it there and then is it stored (MeeshoPacketLink) and the
parcel recorded PACKED in Order Scan — already linked, or refused, marks
nothing — through
Order Scan's own scan recording, so the packing day and the packed counts are
exactly what a scan at the desk would give.

Couriers: Meesho's orders name the courier only by id (carrier_id). Its name
is learned by matching shipments' AWBs to the courier printed on their labels,
and kept (MeeshoCourier).

Every attempt — linked, refused, or failed — is logged (MeeshoLinkLog) with
what was scanned and why it failed; a failed one can be retried from the log
with the values put right.
"""

import json
import os
import re
import threading
import time
from datetime import timedelta
from http.cookiejar import DefaultCookiePolicy

import requests
from requests.adapters import HTTPAdapter
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import (LabelOrder, MeeshoAccount, MeeshoCourier, MeeshoLinkLog, MeeshoPacketLink, MeeshoSyncRun,
                     MeeshoSyncSnapshot, ScannedOrder)

PACKET_RE = re.compile(r"^KP[A-Z0-9]{6,}$")

# Meesho's Scan now → link request (Fulfilment → Scan now).
MEESHO_BASE = os.environ.get("MEESHO_BASE_URL", "https://supplier.meesho.com").rstrip("/")
SUBMIT_PATH = "/api/fulfillment/scan-now/submit"
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")       # as the sync worker sends
ALREADY_LINKED = "ERR_ALREADY_LINKED_AWB_AND_PACKET_ID"
# What Meesho's status codes mean, in the desk's words. Any other ERR_ code is
# spelled out from its name (and kept as it is in the log).
MEESHO_MESSAGES = {
    ALREADY_LINKED: "The AWB is already scanned and linked to this packet on Meesho — scan the next order.",
}
SHIPMENT_TABS = ("orders_ready_to_ship", "orders_shipped")

# One kept-alive connection pool to Meesho for every link, so a link doesn't pay
# a fresh TCP + TLS handshake each time. Its cookie jar takes nothing: each
# request carries its own business's session in the cookie header, and a
# Set-Cookie from one account must never ride along on another's request.
_HTTP = requests.Session()
_HTTP.cookies.set_policy(DefaultCookiePolicy(allowed_domains=[]))
_HTTP.mount("https://", HTTPAdapter(pool_connections=4, pool_maxsize=16, max_retries=0))

# Meesho's order lists, parsed once per sync rather than on every scan: keyed by
# the snapshots' ids and fetch times, so a new read replaces them at once.
_LISTS = {}
_LISTS_LOCK = threading.Lock()


def _cached(kind, accounts, endpoints, build):
    key = (kind, tuple(sorted(MeeshoSyncSnapshot.objects.filter(account__in=accounts, endpoint__in=endpoints)
                              .values_list("pk", "fetched_at"))))
    with _LISTS_LOCK:
        if key in _LISTS:
            return _LISTS[key]
    value = build([k for k, _ in key[1]])
    with _LISTS_LOCK:
        if len(_LISTS) > 32:
            _LISTS.clear()
        _LISTS[key] = value
    return value
LOGS_PER_PAGE = 50


def _views():
    from . import views
    return views


def _clean(code):
    """A scanned code as it is looked up and sent to Meesho. Some couriers'
    labels put the AWB and a routing code in one barcode — "VL0085968979439|
    0G349GGK" — and only the part before the "|" is the AWB (as Order Scan)."""
    return re.sub(r"\s+", "", str(code or "")).split("|", 1)[0].upper()[:100]


def _desk(request, business):
    """The businesses this desk combines (as Order Scan), and their Meesho accounts."""
    desk = _views()._scan_desk_scope(request, business, api_path="meesho-orders/linking/")
    return desk, list(MeeshoAccount.objects.filter(business__in=desk).select_related("business"))


def _shipments(accounts):
    """What Meesho says about each shipment: {AWB: {business_id, packet_id, carrier_id, sub_order_num, sku}}."""
    return _cached("ships", accounts, SHIPMENT_TABS, _build_shipments)


def _build_shipments(snap_ids):
    by_awb = {}
    for snap in MeeshoSyncSnapshot.objects.filter(pk__in=snap_ids).select_related("account"):
        for r in snap.payload if isinstance(snap.payload, list) else []:
            awb = _clean(r.get("awb"))
            if not awb:
                continue
            s = by_awb.setdefault(awb, {"business_id": snap.account.business_id, "packet_id": "", "carrier_id": None,
                                        "sub_order_num": r.get("sub_order_num") or "", "sku": r.get("sku") or ""})
            s["packet_id"] = s["packet_id"] or _clean(r.get("packet_id"))
            s["carrier_id"] = s["carrier_id"] or r.get("carrier_id")
    return by_awb


# Where a shipment's AWB ↔ packet link stands, from Meesho's own lists (Ready
# to ship / Shipped carry the packet Meesho has for each AWB) and our links.
LINKED = "linked"                    # Meesho has a packet for it (ours, if we have one)
OTHER_PACKET = "other_packet"        # Meesho has a different packet than the one linked here
HERE_ONLY = "linked_here_only"       # linked here, Meesho doesn't show it yet (relink, or wait for the next sync)
NOT_LINKED = "not_linked"            # has an AWB, no packet anywhere — link it
NO_AWB = "no_awb"                    # no label yet: nothing to link
NOT_SEEN = "not_seen"                # linked here, but the AWB is on neither Meesho list (shipped on, or cancelled)
LINK_STATES = (LINKED, OTHER_PACKET, HERE_ONLY, NOT_LINKED, NO_AWB, NOT_SEEN)


def link_state(awb, meesho_packet, our_packet, on_meesho=True):
    """The link state for one shipment (see LINK_STATES)."""
    meesho_packet, our_packet = _clean(meesho_packet), _clean(our_packet)
    if not on_meesho:
        return NOT_SEEN
    if meesho_packet:
        return OTHER_PACKET if our_packet and our_packet != meesho_packet else LINKED
    if our_packet:
        return HERE_ONLY
    return NOT_LINKED if _clean(awb) else NO_AWB


def links_by_awb(business_ids, awbs):
    """{(business_id, AWB): MeeshoPacketLink} for these AWBs."""
    awbs = [a for a in {_clean(a) for a in awbs} if a]
    out = {}
    for i in range(0, len(awbs), 500):
        for l in MeeshoPacketLink.objects.filter(business_id__in=business_ids, awb_number__in=awbs[i:i + 500]):
            out[(l.business_id, l.awb_number)] = l
    return out


def _cancelled(business, accounts, sub_order):
    """Whether Meesho shows this order cancelled: its Cancelled list as last read,
    or the orders table's current status."""
    from .models import Order
    if (business.pk, sub_order) in _cancelled_subs(accounts):
        return True
    latest = Order.latest_per_order(Order.objects.filter(business=business, sub_order_no=sub_order)).first()
    return bool(latest and latest.reason_for_credit_entry == "CANCELLED")


def _awbs_in(accounts, endpoint):
    """{AWB} on one of Meesho's order lists (as last read)."""
    def build(ids):
        out = set()
        for snap in MeeshoSyncSnapshot.objects.filter(pk__in=ids):
            out |= {_clean(r.get("awb")) for r in snap.payload or [] if isinstance(r, dict) and r.get("awb")}
        return out
    return _cached(f"awbs:{endpoint}", accounts, (endpoint,), build)


def mark_shipped(accounts, links=None):
    """
    Linked parcels Meesho has moved from Ready to ship to Shipped: their Order Scan
    record says so — shipped, and dispatched if it was only packed. Returns how many changed.
    """
    shipped = _awbs_in(accounts, "orders_shipped")
    if not shipped:
        return 0
    qs = links if links is not None else (MeeshoPacketLink.objects.filter(business__in={a.business_id for a in accounts},
                                                                          awb_number__in=list(shipped)[:20000])
                                          .select_related("scanned_order"))
    changed = 0
    for l in qs:
        so = l.scanned_order
        if l.awb_number not in shipped or not so:
            continue
        fields = []
        if so.ship_status != ScannedOrder.SHIP_SHIPPED:
            so.ship_status, so.ship_status_raw = ScannedOrder.SHIP_SHIPPED, "SHIPPED (Meesho)"
            fields += ["ship_status", "ship_status_raw"]
        if so.status in (ScannedOrder.STATUS_PACKED, ScannedOrder.STATUS_SCANNED):
            so.status, so.status_updated_at = ScannedOrder.STATUS_DISPATCHED, timezone.now()
            fields += ["status", "status_updated_at"]
        if fields:
            so.save(update_fields=fields + ["updated_at"])
            changed += 1
    return changed


LINKED_DAYS = 10


@api_view(["GET"])
def linked_orders(request, business_id):
    """
    Order Scan's "Linked" view: every parcel linked to a packet, and where it is
    on Meesho now — still in Ready to ship, Shipped (marked so here as it moves),
    or on neither list (cancelled, or not read yet). ?state=ready_to_ship|shipped|other.
    Linked in the last LINKED_DAYS days, or still waiting in Ready to ship.
    """
    from .meesho_images import photo_map
    v = _views()
    business = v.get_authorized_business(request, business_id)
    desk = v._scan_desk_scope(request, business)
    accounts = list(MeeshoAccount.objects.filter(business__in=desk))
    rts, shipped = _awbs_in(accounts, "orders_ready_to_ship"), _awbs_in(accounts, "orders_shipped")
    since = timezone.now() - timedelta(days=LINKED_DAYS)
    links = list(MeeshoPacketLink.objects.filter(business__in=desk)
                 .filter(Q(linked_at__gte=since) | Q(awb_number__in=list(rts)[:5000]))
                 .select_related("business", "scanned_order", "linked_by").order_by("-linked_at")[:3000])
    mark_shipped(accounts, links)
    couriers = _courier_names()
    labels = {l.awb_number: l for l in LabelOrder.objects.filter(business__in=desk, awb_number__in=[x.awb_number for x in links])}
    photos = photo_map([labels[x.awb_number] for x in links if x.awb_number in labels], sub_of=lambda l: l.order_id, own=lambda l: "")
    rows, summary, by_courier = [], {"ready_to_ship": 0, "shipped": 0, "other": 0}, {}
    for l in links:
        state = "ready_to_ship" if l.awb_number in rts else "shipped" if l.awb_number in shipped else "other"
        summary[state] += 1
        courier = l.courier_name or couriers.get(l.carrier_id, "") or "Courier not known"
        c = by_courier.setdefault(courier, {"courier": courier, "ready_to_ship": 0, "shipped": 0, "other": 0})
        c[state] += 1
        lab = labels.get(l.awb_number)
        photo, fallback = photos.get((lab.business_id, lab.order_id), (None, None)) if lab else (None, None)
        rows.append({"id": l.pk, "business_name": l.business.name, "awb": l.awb_number, "packet_id": l.packet_id,
                     "sub_order_no": l.sub_order_no, "sku": l.sku or (lab.sku if lab else ""), "size": lab.size if lab else "",
                     "qty": lab.qty if lab else 1, "courier": courier, "state": state, "linked_at": l.linked_at,
                     "linked_by": l.linked_by.username if l.linked_by else None,
                     "image_url": photo, "image_fallback_url": fallback})
    want = request.GET.get("state")
    if want in summary:
        rows = [r for r in rows if r["state"] == want]
    return Response({"summary": summary, "by_courier": sorted(by_courier.values(), key=lambda c: -(c["ready_to_ship"] + c["shipped"])),
                     "checked_at": _checked_at(accounts), "rows": rows})


def _cancelled_subs(accounts):
    """{(business_id, sub-order)} on Meesho's Cancelled lists, as last read."""
    def build(ids):
        out = set()
        for snap in MeeshoSyncSnapshot.objects.filter(pk__in=ids).select_related("account"):
            out |= {(snap.account.business_id, r.get("sub_order_num")) for r in snap.payload or []
                    if isinstance(r, dict) and r.get("sub_order_num")}
        return out
    return _cached("cancelled", accounts, ("orders_cancelled",), build)


def _courier_names():
    return {c.carrier_id: c.name for c in MeeshoCourier.objects.exclude(name="")}


def _link_json(link, couriers=None, ships=None):
    couriers = couriers if couriers is not None else _courier_names()
    ship = (ships or {}).get(link.awb_number) if ships is not None else None
    meesho = {} if ships is None else {
        "state": link_state(link.awb_number, (ship or {}).get("packet_id"), link.packet_id, on_meesho=ship is not None),
        "meesho_packet": (ship or {}).get("packet_id") or None,
    }
    return {**meesho,
        "id": link.pk, "business_id": link.business_id, "business_name": link.business.name,
        "awb": link.awb_number, "packet_id": link.packet_id, "sub_order_no": link.sub_order_no, "sku": link.sku,
        "carrier_id": link.carrier_id, "courier": link.courier_name or couriers.get(link.carrier_id, ""),
        "check": link.meesho_check, "meesho_status": link.meesho_status, "pack_day": link.pack_day, "linked_at": link.linked_at,
        "linked_by": link.linked_by.username if link.linked_by else None,
        "scan_status": link.scanned_order.status if link.scanned_order else None,
    }


def _log(request, action, awb, packet, ok, error="", business=None, link=None, **details):
    return MeeshoLinkLog.objects.create(user=request.user if request.user.is_authenticated else None, business=business,
                                        action=action, awb_number=awb, packet_id=packet, ok=ok, error=error,
                                        link=link, details=details)


def _meesho_message(code):
    if code in MEESHO_MESSAGES:
        return MEESHO_MESSAGES[code]
    words = code[4:] if code.startswith("ERR_") else code
    return f"Meesho refused it: {words.replace('_', ' ').lower()} ({code})."


def _meesho_ok(code):
    """Whether Meesho's answer means it linked the pair."""
    code = str(code or "").upper()
    return not (code.startswith("ERR") or "FAIL" in code or "INVALID" in code)


def _meesho_submit(account, awb, packet, scan):
    """
    Link on Meesho. Returns (status_code, request_id). Meesho answers 200 either
    way; whether it linked is in status_code (ERR_… when it didn't).
    Raises LinkRefused when Meesho can't be asked or won't answer.
    """
    from . import meesho_sync
    if not account.cookies_enc:
        raise LinkRefused("This business has no Meesho session — log in (or paste a session) under Meesho → Settings.",
                          "no_session", status.HTTP_409_CONFLICT)
    try:
        cookies = json.loads(meesho_sync.decrypt(account.cookies_enc))
    except Exception as exc:                                       # noqa: BLE001
        raise LinkRefused(f"The saved Meesho session can't be read ({exc.__class__.__name__}) — log in again under Meesho → Settings.",
                          "no_session", status.HTTP_409_CONFLICT)
    now = int(time.time() * 1000)
    body = {
        "awb_packet_scan_info": {
            "awb": awb, "awb_input_method": scan.get("awb_method") or "SCAN", "awb_scan_ts": int(scan.get("awb_ts") or now - 1000),
            "packet_id": packet, "packet_id_input_method": scan.get("packet_method") or "SCAN",
            "packet_id_scan_ts": int(scan.get("packet_ts") or now),
            "supplier_details": {"id": int(account.supplier_id or 0), "identifier": account.supplier_identifier},
        },
        "request_type": "LINKING", "identifier": account.supplier_identifier,
        "child_supplier_identifier": None, "child_supplier_id": None,
    }
    headers = {
        "accept": "application/json, text/plain, */*", "accept-language": "en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7",
        "client-package-version": "1.0.4", "client-type": "d-web", "content-type": "application/json",
        "identifier": account.supplier_identifier, "origin": MEESHO_BASE, "user-agent": USER_AGENT,
        "referer": f"{MEESHO_BASE}/panel/v3/new/fulfillment/{account.supplier_identifier}/scan-now",
        "cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()),
    }
    if account.browser_id:
        headers["browser-id"] = account.browser_id
    try:
        res = _HTTP.post(MEESHO_BASE + SUBMIT_PATH, json=body, headers=headers, timeout=(5, 20))
    except requests.RequestException as exc:
        raise LinkRefused(f"Couldn't reach Meesho ({exc.__class__.__name__}) — try again.", "meesho_unreachable",
                          status.HTTP_502_BAD_GATEWAY)
    try:
        answer = res.json()
    except ValueError:
        answer = {}
    if res.status_code in (401, 403, 463):          # 463: "Unauthorized call. Token missing." — the session token expired
        why = "Meesho's bot protection blocked the server" if "<html" in res.text[:500].lower() else "the Meesho session has expired"
        raise LinkRefused(f"Not linked — {why}. Log in again (or paste a session) under Meesho → Settings.", "meesho_session",
                          status.HTTP_409_CONFLICT, meesho_http=res.status_code)
    if res.status_code >= 400 or not isinstance(answer, dict):
        msg = (answer.get("message") or answer.get("error")) if isinstance(answer, dict) else None
        raise LinkRefused(f"Meesho answered HTTP {res.status_code}{f': {msg}' if msg else ''} — not linked.", "meesho_error",
                          status.HTTP_502_BAD_GATEWAY, meesho_http=res.status_code)
    return str(answer.get("status_code") or "LINKED"), str(answer.get("request_id") or "")


# A session that can't be used — the next business's is tried instead.
SESSION_CODES = ("no_session", "meesho_session")


def _send_link(owner, accounts, awb, packet, scan):
    """
    Link on Meesho through the parcel's own business's session — or, when that
    one isn't connected or has expired, through any other connected business on
    the desk: Meesho links any business's AWB and packet from any of them. So
    one expired session never stops the desk. A refusal from Meesho itself
    (ERR_…) is final; only an unusable session moves on to the next.
    Returns (status_code, request_id, the business it went through).
    """
    live = [a for a in accounts if a.status == MeeshoAccount.STATUS_ACTIVE]
    order = sorted(live, key=lambda a: (a.business_id != owner.pk, a.pk))
    if not order:
        raise LinkRefused("No business on this desk has a connected Meesho session — log in under Meesho → Settings.",
                          "no_account", status.HTTP_409_CONFLICT)
    last = None
    for account in order:
        try:
            code, request_id = _meesho_submit(account, awb, packet, scan)
            return code, request_id, account.business.name
        except LinkRefused as e:
            if e.code not in SESSION_CODES:
                raise
            last = e
    raise LinkRefused(f"{last} (every connected business's session was tried.)", last.code, last.http, **last.details)


class LinkRefused(Exception):
    def __init__(self, message, code="refused", http=status.HTTP_409_CONFLICT, **details):
        super().__init__(message)
        self.code, self.http, self.details = code, http, details


def _link(request, business, awb, packet, override=False, scan=None):
    """
    Check, link on Meesho, record PACKED in Order Scan, and store one link.
    Returns (link, previous packet, Order Scan's answer, Meesho's status code).
    Raises LinkRefused.
    """
    v = _views()
    if not awb or not packet:
        raise LinkRefused("Scan both the AWB and the packet QR.", "missing", status.HTTP_400_BAD_REQUEST)
    if PACKET_RE.match(awb) and not PACKET_RE.match(packet):
        awb, packet = packet, awb                                   # scanned the other way round
    if PACKET_RE.match(awb):
        raise LinkRefused("Both codes look like packet QRs — scan the AWB on the label.", "two_packets", status.HTTP_400_BAD_REQUEST)
    if not PACKET_RE.match(packet):
        raise LinkRefused(f"“{packet}” isn't a packet QR (they start with KP).", "not_a_packet", status.HTTP_400_BAD_REQUEST)

    desk, accounts = _desk(request, business)
    ship = _shipments(accounts).get(awb)
    owner, snap = v._resolve_scan_code_pooled(request, business, awb, "meesho")
    if not ship and snap["matched_from"] == ScannedOrder.MATCH_NONE:
        raise LinkRefused(f"AWB {awb} isn't on any label or Meesho order here — check the code, or upload / generate its label first.",
                          "unknown_awb", status.HTTP_404_NOT_FOUND)
    if ship:
        owner = next((b for b in desk if b.pk == ship["business_id"]), owner)

    check = MeeshoPacketLink.CHECK_UNKNOWN
    if ship and ship["packet_id"]:
        if ship["packet_id"] == packet:
            check = MeeshoPacketLink.CHECK_MATCH
        elif not override:
            raise LinkRefused(f"Meesho has packet {ship['packet_id']} for AWB {awb}, not {packet}. Check the parcel — "
                              f"or link anyway if this packet is right.", "packet_mismatch", meesho_packet=ship["packet_id"])
        else:
            check = MeeshoPacketLink.CHECK_OVERRIDDEN
    taken = (MeeshoPacketLink.objects.filter(business__in=desk, packet_id=packet).exclude(awb_number=awb)
             .select_related("business").first())
    if taken and not override:
        raise LinkRefused(f"Packet {packet} is already linked to AWB {taken.awb_number} ({taken.business.name}). "
                          f"Unlink that first — or link anyway.", "packet_taken", other_awb=taken.awb_number)

    # A cancelled order isn't packed: refused here, so it never counts in Order Scan.
    sub = (ship or {}).get("sub_order_num") or snap.get("sub_order_no") or ""
    if sub and _cancelled(owner, accounts, sub):
        raise LinkRefused(f"Order {sub} is cancelled on Meesho — not linked, not marked packed. Keep the parcel aside.",
                          "cancelled", status.HTTP_409_CONFLICT, sub_order=sub)

    # Meesho first: nothing is stored or marked packed unless Meesho takes it
    # (or already had it — then this only brings our side in line).
    meesho_code, request_id, via = _send_link(owner, accounts, awb, packet, scan or {})
    # Only a link Meesho made just now marks the parcel packed. Already linked,
    # or any refusal: nothing is stored or marked here — the desk is told, and
    # stops until someone acknowledges it.
    if meesho_code == ALREADY_LINKED:
        raise LinkRefused(_meesho_message(meesho_code) + " Not marked packed here.", "already_linked", status.HTTP_409_CONFLICT,
                          meesho_code=meesho_code, request_id=request_id)
    if not _meesho_ok(meesho_code):
        raise LinkRefused(_meesho_message(meesho_code), "meesho_refused", status.HTTP_409_CONFLICT,
                          meesho_code=meesho_code, request_id=request_id)

    # PACKED in Order Scan, exactly as a scan at the desk records it.
    res = v._record_scan(request, business, v._scan_desk_scope(request, business),
                         {"code": awb, "status": ScannedOrder.STATUS_PACKED, "platform": "meesho"})
    if res.status_code >= 400:
        raise LinkRefused(f"Order Scan didn't take it: {res.data.get('error', res.status_code)}", "scan_failed",
                          status.HTTP_400_BAD_REQUEST)
    row = res.data.get("row") or {}
    scanned = ScannedOrder.objects.filter(pk=row.get("id")).first()

    carrier_id = ship["carrier_id"] if ship else None
    courier = (MeeshoCourier.objects.filter(carrier_id=carrier_id).values_list("name", flat=True).first() if carrier_id else "") \
        or snap.get("courier_name") or ""
    with transaction.atomic():
        if taken:                                                  # linked anyway: the packet moves to this AWB
            taken.delete()
        link, created = MeeshoPacketLink.objects.select_for_update().get_or_create(
            business=owner, awb_number=awb, defaults={"packet_id": packet, "linked_at": timezone.now()})
        before = None if created else link.packet_id
        link.packet_id = packet
        link.sub_order_no = (ship or {}).get("sub_order_num") or snap.get("sub_order_no") or ""
        link.sku = (ship or {}).get("sku") or snap.get("sku") or ""
        link.carrier_id = carrier_id
        link.courier_name = courier
        link.meesho_check = check
        link.meesho_status = "LINKED"
        link.meesho_request_id = request_id[:64]
        link.scanned_order = scanned
        link.pack_day = scanned.scan_day if scanned else v._current_business_date()
        link.linked_by = request.user
        link.linked_at = timezone.now()
        link.save()
        if carrier_id and snap.get("courier_name"):
            _learn_courier(carrier_id, snap["courier_name"])
    link.via = via
    return link, before, res.data, meesho_code


def _day_window(request, desk, day_param=None):
    """The packing day on screen (?day=, else the one the Order Scan desk is on — it turns
    at 1 pm, once the new day has work) and the window its links are counted in."""
    v = _views()
    day = v._parse_day(day_param or "") or v._following_day(request, [b.pk for b in desk])[0]
    # Every link made in this packing day's window (1 pm to 1 pm) — and any filed under it. A scan can
    # be counted toward the previous day's list (its label is on it) while the next scan starts the new
    # day, so going by pack_day alone split one evening's links across two days ("scanned 4, shows 1").
    start, end = v._packing_day_window(day)
    if not day_param:
        now_start, now_end = v._packing_day_window(v._current_business_date())
        start, end = min(start, now_start), max(end, now_end)
    return day, start, end


def _day_links(desk, day, start, end):
    return (MeeshoPacketLink.objects.filter(business__in=desk)
            .filter(Q(pack_day=day) | Q(linked_at__gte=start, linked_at__lt=end)))


def _live(desk, day, start, end, accounts, ships=None):
    """
    The day's packed count, straight from the links stored — each one a scan
    Meesho answered green, counted the moment it is made. Nothing queued or
    synced adds to it; it drops only when the order is cancelled (on Meesho's
    Cancelled list, or cancelled at the desk) or the link is undone.
    """
    cancelled_subs = _cancelled_subs(accounts)
    couriers = _courier_names()
    out = {"packed": 0, "cancelled": 0, "by_courier": {}, "links": {}}
    for l in _day_links(desk, day, start, end).select_related("scanned_order"):
        so = l.scanned_order
        gone = bool(l.sub_order_no and (l.business_id, l.sub_order_no) in cancelled_subs) \
            or bool(so and so.status == ScannedOrder.STATUS_CANCELLED)
        name = " ".join((l.courier_name or couriers.get(l.carrier_id, "") or "").split()) or "No courier on label"
        out["links"][(l.business_id, l.awb_number)] = {"cancelled": gone, "courier": name}
        if gone:
            out["cancelled"] += 1
            continue
        out["packed"] += 1
        out["by_courier"][name] = out["by_courier"].get(name, 0) + 1
    return out


def _counts(request, desk, accounts, day_param=None):
    """The day's counts alone — what the desk's screen refreshes after every scan."""
    day, start, end = _day_window(request, desk, day_param)
    ships = _shipments(accounts)
    live = _live(desk, day, start, end, accounts, ships)
    return {"day": day, "count": live["packed"], "cancelled_after": live["cancelled"],
            "by_courier": sorted(({"courier": k, "count": n} for k, n in live["by_courier"].items()), key=lambda x: -x["count"]),
            "plan": _plan(request, desk, day, ships, live, details=False), "at": timezone.now()}


@api_view(["GET"])
def link_counts(request, business_id):
    """GET — the day's packed counts, read from the links as they stand right now (?day=)."""
    business = _views().get_authorized_business(request, business_id)
    desk, accounts = _desk(request, business)
    return Response(_counts(request, desk, accounts, request.GET.get("day")))


def _learn_courier(carrier_id, name):
    name = " ".join(str(name).split())[:100]
    c, _ = MeeshoCourier.objects.get_or_create(carrier_id=int(carrier_id), defaults={"name": name, "source": "labels"})
    if not c.name and name:
        c.name, c.source = name, "labels"
        c.save(update_fields=["name", "source", "updated_at"])


@api_view(["GET", "POST"])
def linking(request, business_id):
    """
    GET  — the day's links (?day=YYYY-MM-DD, default the packing day open now; ?q=),
           their counts by courier, and the couriers.
    POST — link: {awb, packet_id, override?}. Records the parcel PACKED in Order Scan.
    """
    v = _views()
    business = v.get_authorized_business(request, business_id)
    if request.method == "POST":
        d = request.data if isinstance(request.data, dict) else {}
        return _do_link(request, business, _clean(d.get("awb")), _clean(d.get("packet_id")),
                        bool(d.get("override")), MeeshoLinkLog.ACTION_LINK, scan=_scan_info(d))

    desk, _ = _desk(request, business)
    day, start, end = _day_window(request, desk, request.GET.get("day"))
    qs = _day_links(desk, day, start, end).select_related("business", "linked_by", "scanned_order").order_by("-linked_at")
    q = _clean(request.GET.get("q"))
    if q:
        qs = qs.filter(Q(awb_number__icontains=q) | Q(packet_id__icontains=q) | Q(sub_order_no__icontains=q) | Q(sku__icontains=q))
    couriers = _courier_names()
    ships = _shipments(_)                       # what Meesho shows now, for each link's state
    links = [_link_json(l, couriers, ships) for l in qs[:2000]]
    states = {}
    for l in links:
        states[l["state"]] = states.get(l["state"], 0) + 1
    biz_ids = [b.pk for b in desk]
    errors = MeeshoLinkLog.objects.filter(Q(business_id__in=biz_ids) | Q(business__isnull=True, user=request.user),
                                          ok=False, resolved=False, created_at__date__gte=day).count()
    live = _live(desk, day, start, end, _, ships)
    return Response({
        "day": day, "links": links,
        # Packed: every green link of the day, counted from the links themselves the moment
        # they're made — less any whose order is cancelled since. Never from a queued read of Meesho.
        "count": live["packed"], "cancelled_after": live["cancelled"],
        "matched": sum(1 for l in links if l["check"] == MeeshoPacketLink.CHECK_MATCH),
        "states": states,
        "checked_at": _checked_at(_),
        "by_courier": sorted(({"courier": k, "count": n} for k, n in live["by_courier"].items()), key=lambda x: -x["count"]),
        "open_errors": errors,
        "couriers": [{"carrier_id": c.carrier_id, "name": c.name, "source": c.source, "shipments": c.shipments_seen}
                     for c in MeeshoCourier.objects.all()],
        "is_admin": v._is_admin(request.user),
        "syncing": _syncing(_),
        "plan": _plan(request, desk, day, ships, live),
    })


def _syncing(accounts):
    """Whether a read of Meesho's lists is queued or running for these accounts."""
    from .meesho_sync import STUCK_AFTER
    return MeeshoSyncRun.objects.filter(account__in=accounts, status__in=[MeeshoSyncRun.STATUS_QUEUED, MeeshoSyncRun.STATUS_RUNNING],
                                        queued_at__gte=timezone.now() - STUCK_AFTER).exists()


@api_view(["POST"])
def link_check(request, business_id):
    """
    "Check with Meesho" — read the desk's Meesho lists again, so each link's
    state is fresh. Linking's own, so a person with only Order Linking can use it.
    """
    from . import meesho_sync
    business = _views().get_authorized_business(request, business_id)
    _desk_biz, accounts = _desk(request, business)
    live = [a for a in accounts if a.status != MeeshoAccount.STATUS_DISABLED]
    if not live:
        return Response({"error": "Connect a Meesho account first."}, status=status.HTTP_400_BAD_REQUEST)
    queued = 0
    try:
        for a in live:
            _, q = meesho_sync._queue_run(a, MeeshoSyncRun.KIND_SYNC, MeeshoSyncRun.TRIGGER_MANUAL)
            queued += int(q)
    except meesho_sync.SyncNotConfigured as exc:
        return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({"queued": queued, "accounts": len(live)})


def _scan_info(d):
    """How each code was entered (SCAN / MANUAL) and when — passed on to Meesho as the panel does."""
    out = {}
    for k in ("awb_method", "packet_method"):
        v = str(d.get(k) or "").upper()
        if v in ("SCAN", "MANUAL"):
            out[k] = v
    for k in ("awb_ts", "packet_ts"):
        try:
            out[k] = int(d.get(k))
        except (TypeError, ValueError):
            pass
    return out


def _do_link(request, business, awb, packet, override, action, retry_of=None, scan=None):
    started = time.monotonic()
    try:
        link, before, scan, meesho_code = _link(request, business, awb, packet, override, scan)
    except LinkRefused as e:
        log = _log(request, action, awb, packet, False, str(e), business=business, code=e.code, override=override,
                   retry_of=retry_of, **e.details)
        return Response({"error": str(e), "code": e.code, "log_id": log.pk, "can_override": e.code in ("packet_mismatch", "packet_taken"),
                         **e.details}, status=e.http)
    except Exception as e:                                        # noqa: BLE001 — logged, so it can be found and retried
        log = _log(request, action, awb, packet, False, f"Unexpected error: {e.__class__.__name__}: {e}", business=business,
                   retry_of=retry_of)
        return Response({"error": "Something went wrong — it's in the log.", "code": "error", "log_id": log.pk},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    action = MeeshoLinkLog.ACTION_RELINK if before and before != packet and action == MeeshoLinkLog.ACTION_LINK else action
    log = _log(request, action, link.awb_number, link.packet_id, True, "", business=link.business, link=link,
               check=link.meesho_check, previous_packet=before, already_scanned=bool(scan.get("already_scanned")),
               scan_count=scan.get("scan_count"), retry_of=retry_of, meesho_code=meesho_code,
               request_id=link.meesho_request_id, via=getattr(link, "via", None))
    if retry_of:
        MeeshoLinkLog.objects.filter(pk=retry_of).update(resolved=True)
    body = {"link": _link_json(link), "log_id": log.pk, "previous_packet": before, "meesho_code": meesho_code,
            "already_scanned": bool(scan.get("already_scanned")), "stats": scan.get("stats"),
            "product": _product(link), "ms": int((time.monotonic() - started) * 1000), "via": getattr(link, "via", None)}
    # The day's counts as they stand with this link in them — the screen shows them from this answer at once.
    try:
        desk, accounts = _desk(request, business)
        body["counts"] = _counts(request, desk, accounts)
    except Exception:                                              # noqa: BLE001 — the link is made; the screen reads them again
        body["counts"] = None
    return Response(body, status=status.HTTP_201_CREATED)


def _product(link):
    """What is in the parcel just linked — its label's SKU, size and quantity, and a photo."""
    from .meesho_images import photo_map
    label = (LabelOrder.objects.filter(business_id=link.business_id, awb_number=link.awb_number).order_by("-uploaded_date").first()
             or (LabelOrder.objects.filter(business_id=link.business_id, order_id=link.sub_order_no).order_by("-uploaded_date").first()
                 if link.sub_order_no else None))
    row = label or link
    sub = label.order_id if label else link.sub_order_no
    try:
        photo, fallback = photo_map([row], sub_of=lambda _r: sub, own=lambda _r: "").get((link.business_id, sub), (None, None))
    except Exception:                                              # noqa: BLE001 — a photo is never worth failing a link
        photo, fallback = None, None
    return {"sku": (label.sku if label else link.sku) or "", "size": label.size if label else "", "qty": (label.qty if label else None) or 1,
            "sub_order_no": sub, "image_url": photo, "image_fallback_url": fallback}


def _plan(request, desk, day, ships, live=None, details=True):
    """
    The day's Meesho parcels to link — every Meesho label downloaded for the
    packing day, and any parcel linked today that isn't on them — and where each
    stands: packed (scanned here and Meesho answered green), cancelled, or still
    to link. A parcel counts as packed only from its own scan here — never
    because a sync of Meesho's lists shows it linked; those are only pointed out
    ("linked on Meesho, not scanned here"). Counted per courier and in total;
    with `details`, the ones left are listed with their product.
    """
    from .meesho_images import photo_map
    v = _views()
    ids = [b.pk for b in desk]
    names = {b.pk: b.name for b in desk}
    accounts = list(MeeshoAccount.objects.filter(business_id__in=ids))
    if live is None:
        start, end = v._packing_day_window(day)
        live = _live(desk, day, start, end, accounts, ships)
    labels = list(v._labels_on_day(LabelOrder.objects.filter(business_id__in=ids).exclude(platform="flipkart"), day)
                  .order_by("courier_name", "sku", "order_id")[:4000])
    # Linked here on any day (a label carried over from yesterday may have been scanned then).
    linked = {(b, a): None for b, a in MeeshoPacketLink.objects.filter(
        business_id__in=ids, awb_number__in=[_clean(l.awb_number) for l in labels if l.awb_number])
        .values_list("business_id", "awb_number")}
    cancelled = _cancelled_subs(accounts)
    couriers, left, seen = {}, [], set()
    on_meesho_only = 0

    def bucket(name):
        return couriers.setdefault(name.casefold(), {"courier": name, "total": 0, "linked": 0, "left": 0, "cancelled": 0})

    for l in labels:
        name = " ".join((l.courier_name or "").split()) or "No courier on label"
        c = bucket(name)
        awb = _clean(l.awb_number)
        key = (l.business_id, awb)
        seen.add(key)
        mine = live["links"].get(key)
        if (l.business_id, l.order_id) in cancelled or (mine and mine["cancelled"]):
            c["cancelled"] += 1
        elif key in linked:
            c["total"] += 1
            c["linked"] += 1
        else:
            c["total"] += 1
            c["left"] += 1
            left.append(l)
            if (ships.get(awb) or {}).get("packet_id"):
                on_meesho_only += 1
    # Scanned green today but not on the day's labels (a label from another day, or not downloaded here):
    # still packed today, so still counted.
    for key, info in live["links"].items():
        if key in seen:
            continue
        c = bucket(info["courier"])
        if info["cancelled"]:
            c["cancelled"] += 1
        else:
            c["total"] += 1
            c["linked"] += 1
    photos = photo_map(left[:300], sub_of=lambda l: l.order_id, own=lambda l: "") if left and details else {}
    by_courier = sorted(couriers.values(), key=lambda c: (-c["total"], c["courier"]))
    return {
        "day": day,
        "total": sum(c["total"] for c in by_courier),
        "linked": sum(c["linked"] for c in by_courier),
        "left": sum(c["left"] for c in by_courier),
        "cancelled": sum(c["cancelled"] for c in by_courier),
        "on_meesho_only": on_meesho_only,
        "by_courier": by_courier,
        "left_awbs": [_clean(l.awb_number) for l in left] if not details else None,
        "left_orders": [] if not details else [{"business_name": names.get(l.business_id, ""), "sub_order_no": l.order_id, "awb": _clean(l.awb_number),
                         "sku": l.sku, "size": l.size, "qty": l.qty or 1,
                         "courier": " ".join((l.courier_name or "").split()) or "No courier on label",
                         "image_url": photos.get((l.business_id, l.order_id), (None, None))[0],
                         "image_fallback_url": photos.get((l.business_id, l.order_id), (None, None))[1]} for l in left[:300]],
    }


def _checked_at(accounts):
    """When Meesho's lists the states come from were last read (the older of the two)."""
    t = [s.fetched_at for s in MeeshoSyncSnapshot.objects.filter(account__in=accounts, endpoint__in=SHIPMENT_TABS)]
    return min(t) if t else None


@api_view(["POST"])
def link_relink(request, business_id, link_id):
    """
    Link this AWB on Meesho again — with the same packet (Meesho didn't take it,
    or doesn't show it), or a new one ({packet_id}) when the parcel was repacked.
    Meesho's answer decides, as for a fresh link; logged as a relink.
    """
    v = _views()
    business = v.get_authorized_business(request, business_id)
    desk, _ = _desk(request, business)
    link = MeeshoPacketLink.objects.filter(pk=link_id, business__in=desk).first()
    if not link:
        return Response({"error": "No such link."}, status=status.HTTP_404_NOT_FOUND)
    d = request.data if isinstance(request.data, dict) else {}
    packet = _clean(d.get("packet_id")) or link.packet_id
    return _do_link(request, business, link.awb_number, packet, True, MeeshoLinkLog.ACTION_RELINK, scan=_scan_info(d))


@api_view(["DELETE"])
def link_detail(request, business_id, link_id):
    """Unlink: the AWB and packet are no longer paired (the Order Scan record stays)."""
    v = _views()
    business = v.get_authorized_business(request, business_id)
    desk, _ = _desk(request, business)
    link = MeeshoPacketLink.objects.filter(pk=link_id, business__in=desk).first()
    if not link:
        return Response({"error": "No such link."}, status=status.HTTP_404_NOT_FOUND)
    _log(request, MeeshoLinkLog.ACTION_UNLINK, link.awb_number, link.packet_id, True, business=link.business)
    link.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


def _visible_logs(request, desk):
    ids = [b.pk for b in desk]
    return MeeshoLinkLog.objects.filter(Q(business_id__in=ids) | Q(business__isnull=True))


@api_view(["GET"])
def link_logs(request, business_id):
    """Every linking attempt (?errors=1 for the open failures only, ?q=, ?page=)."""
    v = _views()
    business = v.get_authorized_business(request, business_id)
    desk, _ = _desk(request, business)
    qs = _visible_logs(request, desk).select_related("user", "business")
    if request.GET.get("errors"):
        qs = qs.filter(ok=False, resolved=False)
    q = _clean(request.GET.get("q"))
    if q:
        qs = qs.filter(Q(awb_number__icontains=q) | Q(packet_id__icontains=q) | Q(error__icontains=q))
    try:
        page = max(1, int(request.GET.get("page", 1)))
    except ValueError:
        page = 1
    total = qs.count()
    rows = qs[(page - 1) * LOGS_PER_PAGE: page * LOGS_PER_PAGE]
    return Response({"total": total, "page": page, "page_size": LOGS_PER_PAGE, "logs": [{
        "id": l.pk, "at": l.created_at, "action": l.action, "awb": l.awb_number, "packet_id": l.packet_id,
        "ok": l.ok, "error": l.error, "resolved": l.resolved, "details": l.details,
        "user": l.user.username if l.user else None, "business_name": l.business.name if l.business else "",
    } for l in rows]})


@api_view(["POST", "PATCH"])
def link_log_detail(request, business_id, log_id):
    """
    POST  — retry a failed attempt, with the values put right: {awb?, packet_id?, override?}.
    PATCH — {resolved: true|false}: mark a failure handled without retrying it.
    """
    v = _views()
    business = v.get_authorized_business(request, business_id)
    desk, _ = _desk(request, business)
    log = _visible_logs(request, desk).filter(pk=log_id).first()
    if not log:
        return Response({"error": "No such log entry."}, status=status.HTTP_404_NOT_FOUND)
    d = request.data if isinstance(request.data, dict) else {}
    if request.method == "PATCH":
        log.resolved = bool(d.get("resolved", True))
        log.save(update_fields=["resolved"])
        return Response({"id": log.pk, "resolved": log.resolved})
    return _do_link(request, business, _clean(d.get("awb") or log.awb_number), _clean(d.get("packet_id") or log.packet_id),
                    bool(d.get("override")), MeeshoLinkLog.ACTION_RETRY, retry_of=log.pk,
                    scan={"awb_method": "MANUAL", "packet_method": "MANUAL"})


@api_view(["POST"])
def couriers_refresh(request, business_id):
    """
    Learn every courier's name from the shipments the sync pulled: each one's
    courier id (Meesho) against the courier on its label (by AWB).
    """
    v = _views()
    business = v.get_authorized_business(request, business_id)
    desk, accounts = _desk(request, business)
    try:
        ships = _shipments(accounts)
        awb_courier = {}
        awbs = list(ships)
        for i in range(0, len(awbs), 500):
            for awb, name in (LabelOrder.objects.filter(business__in=desk, awb_number__in=awbs[i:i + 500])
                              .exclude(courier_name="").values_list("awb_number", "courier_name")):
                awb_courier[_clean(awb)] = " ".join(name.split())
        votes, seen = {}, {}
        for awb, s in ships.items():
            cid = s["carrier_id"]
            if cid is None:
                continue
            seen[cid] = seen.get(cid, 0) + 1
            if awb in awb_courier:
                votes.setdefault(cid, {}).setdefault(awb_courier[awb], 0)
                votes[cid][awb_courier[awb]] += 1
        learned = 0
        for cid, n in seen.items():
            c, _ = MeeshoCourier.objects.get_or_create(carrier_id=int(cid))
            c.shipments_seen = n
            names = votes.get(cid)
            if names and c.source != "manual":
                c.name = max(names, key=names.get)
                c.source = "labels"
                c.details = {**(c.details or {}), "label_names": names}
                learned += 1
            c.save()
        _log(request, MeeshoLinkLog.ACTION_COURIERS, "", "", True, business=business, couriers=len(seen), named=learned)
    except Exception as e:                                        # noqa: BLE001
        _log(request, MeeshoLinkLog.ACTION_COURIERS, "", "", False, f"{e.__class__.__name__}: {e}", business=business)
        return Response({"error": f"Couldn't read the couriers: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return Response({"couriers": [{"carrier_id": c.carrier_id, "name": c.name, "source": c.source, "shipments": c.shipments_seen}
                                  for c in MeeshoCourier.objects.all()], "named": learned})


@api_view(["PATCH"])
def courier_detail(request, business_id, carrier_id):
    """Admin: name a courier by hand: {name}."""
    v = _views()
    v.get_authorized_business(request, business_id)
    if not v._is_admin(request.user):
        return Response({"error": "Only an admin can rename couriers."}, status=status.HTTP_403_FORBIDDEN)
    name = " ".join(str((request.data or {}).get("name") or "").split())[:100]
    c, _ = MeeshoCourier.objects.get_or_create(carrier_id=carrier_id)
    c.name, c.source = name, "manual" if name else ""
    c.save()
    return Response({"carrier_id": c.carrier_id, "name": c.name, "source": c.source})
