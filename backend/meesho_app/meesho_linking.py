"""
Meesho Orders → Order linking: link a shipment's AWB to its packet (the packet
QR, "KP…") at the packing desk.

A link is checked against what the sync knows of that AWB's packet (the Ready
to ship / Shipped tabs carry each shipment's AWB, packet id and courier id),
then sent to Meesho — the panel's own Scan now → link request — straight from
here with the account's saved session, so the desk hears back at once. Only
when Meesho takes it (or says it's already linked) is it stored
(MeeshoPacketLink) and the parcel recorded PACKED in Order Scan — through
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
import time

import requests
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import (LabelOrder, MeeshoAccount, MeeshoCourier, MeeshoLinkLog, MeeshoPacketLink, MeeshoSyncSnapshot,
                     ScannedOrder)

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
LOGS_PER_PAGE = 50


def _views():
    from . import views
    return views


def _clean(code):
    return re.sub(r"\s+", "", str(code or "")).upper()[:100]


def _desk(request, business):
    """The businesses this desk combines (as Order Scan), and their Meesho accounts."""
    desk = _views()._scan_desk_scope(request, business, api_path="meesho-orders/linking/")
    return desk, list(MeeshoAccount.objects.filter(business__in=desk))


def _shipments(accounts):
    """What Meesho says about each shipment: {AWB: {business_id, packet_id, carrier_id, sub_order_num, sku}}."""
    by_awb = {}
    for snap in MeeshoSyncSnapshot.objects.filter(account__in=accounts, endpoint__in=SHIPMENT_TABS).select_related("account"):
        for r in snap.payload if isinstance(snap.payload, list) else []:
            awb = _clean(r.get("awb"))
            if not awb:
                continue
            s = by_awb.setdefault(awb, {"business_id": snap.account.business_id, "packet_id": "", "carrier_id": None,
                                        "sub_order_num": r.get("sub_order_num") or "", "sku": r.get("sku") or ""})
            s["packet_id"] = s["packet_id"] or _clean(r.get("packet_id"))
            s["carrier_id"] = s["carrier_id"] or r.get("carrier_id")
    return by_awb


def _courier_names():
    return {c.carrier_id: c.name for c in MeeshoCourier.objects.exclude(name="")}


def _link_json(link, couriers=None):
    couriers = couriers if couriers is not None else _courier_names()
    return {
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


def _meesho_submit(account, awb, packet, scan):
    """
    Link on Meesho. Returns (status_code, request_id). Meesho answers 200 either
    way; whether it linked is in status_code (ERR_… when it didn't).
    Raises LinkRefused when Meesho can't be asked or won't answer.
    """
    from . import meesho_sync
    if not account.cookies_enc:
        raise LinkRefused("This business has no Meesho session — log in (or paste a session) on Accounts & sync.",
                          "no_session", status.HTTP_409_CONFLICT)
    try:
        cookies = json.loads(meesho_sync.decrypt(account.cookies_enc))
    except Exception as exc:                                       # noqa: BLE001
        raise LinkRefused(f"The saved Meesho session can't be read ({exc.__class__.__name__}) — log in again on Accounts & sync.",
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
        res = requests.post(MEESHO_BASE + SUBMIT_PATH, json=body, headers=headers, timeout=20)
    except requests.RequestException as exc:
        raise LinkRefused(f"Couldn't reach Meesho ({exc.__class__.__name__}) — try again.", "meesho_unreachable",
                          status.HTTP_502_BAD_GATEWAY)
    try:
        answer = res.json()
    except ValueError:
        answer = {}
    if res.status_code in (401, 403):
        why = "Meesho's bot protection blocked the server" if "<html" in res.text[:500].lower() else "the Meesho session has expired"
        raise LinkRefused(f"Not linked — {why}. Log in again (or paste a session) on Accounts & sync.", "meesho_session",
                          status.HTTP_409_CONFLICT, meesho_http=res.status_code)
    if res.status_code >= 400 or not isinstance(answer, dict):
        msg = (answer.get("message") or answer.get("error")) if isinstance(answer, dict) else None
        raise LinkRefused(f"Meesho answered HTTP {res.status_code}{f': {msg}' if msg else ''} — not linked.", "meesho_error",
                          status.HTTP_502_BAD_GATEWAY, meesho_http=res.status_code)
    return str(answer.get("status_code") or "LINKED"), str(answer.get("request_id") or "")


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

    # Meesho first: nothing is stored or marked packed unless Meesho takes it
    # (or already had it — then this only brings our side in line).
    account = MeeshoAccount.objects.filter(business=owner).first()
    if not account or account.status != MeeshoAccount.STATUS_ACTIVE:
        raise LinkRefused(f"{owner.name}'s Meesho account isn't connected — connect it on Accounts & sync.", "no_account",
                          status.HTTP_409_CONFLICT)
    meesho_code, request_id = _meesho_submit(account, awb, packet, scan or {})
    if meesho_code.startswith("ERR") and meesho_code != ALREADY_LINKED:
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
        link.meesho_status = "LINKED" if not meesho_code.startswith("ERR") else meesho_code
        link.meesho_request_id = request_id[:64]
        link.scanned_order = scanned
        link.pack_day = scanned.scan_day if scanned else v._current_business_date()
        link.linked_by = request.user
        link.linked_at = timezone.now()
        link.save()
        if carrier_id and snap.get("courier_name"):
            _learn_courier(carrier_id, snap["courier_name"])
    return link, before, res.data, meesho_code


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
    day = v._parse_day(request.GET.get("day") or "") or v._current_business_date()
    qs = MeeshoPacketLink.objects.filter(business__in=desk, pack_day=day).select_related("business", "linked_by", "scanned_order")
    q = _clean(request.GET.get("q"))
    if q:
        qs = qs.filter(Q(awb_number__icontains=q) | Q(packet_id__icontains=q) | Q(sub_order_no__icontains=q) | Q(sku__icontains=q))
    couriers = _courier_names()
    links = [_link_json(l, couriers) for l in qs[:2000]]
    by_courier = {}
    for l in links:
        name = l["courier"] or (f"Courier #{l['carrier_id']}" if l["carrier_id"] else "Courier not known")
        by_courier[name] = by_courier.get(name, 0) + 1
    biz_ids = [b.pk for b in desk]
    errors = MeeshoLinkLog.objects.filter(Q(business_id__in=biz_ids) | Q(business__isnull=True, user=request.user),
                                          ok=False, resolved=False, created_at__date__gte=day).count()
    return Response({
        "day": day, "links": links, "count": len(links),
        "matched": sum(1 for l in links if l["check"] == MeeshoPacketLink.CHECK_MATCH),
        "by_courier": sorted(({"courier": k, "count": n} for k, n in by_courier.items()), key=lambda x: -x["count"]),
        "open_errors": errors,
        "couriers": [{"carrier_id": c.carrier_id, "name": c.name, "source": c.source, "shipments": c.shipments_seen}
                     for c in MeeshoCourier.objects.all()],
        "is_admin": v._is_admin(request.user),
    })


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
    already = meesho_code == ALREADY_LINKED
    log = _log(request, action, link.awb_number, link.packet_id, True,
               _meesho_message(meesho_code) if already else "", business=link.business, link=link,
               check=link.meesho_check, previous_packet=before, already_scanned=bool(scan.get("already_scanned")),
               scan_count=scan.get("scan_count"), retry_of=retry_of, meesho_code=meesho_code,
               request_id=link.meesho_request_id)
    if retry_of:
        MeeshoLinkLog.objects.filter(pk=retry_of).update(resolved=True)
    body = {"link": _link_json(link), "log_id": log.pk, "previous_packet": before, "meesho_code": meesho_code,
            "already_scanned": bool(scan.get("already_scanned")), "stats": scan.get("stats")}
    if already:
        # As Meesho's own prompt: already done — scan the next order.
        return Response({**body, "error": _meesho_message(meesho_code), "code": "already_linked"}, status=status.HTTP_409_CONFLICT)
    return Response(body, status=status.HTTP_201_CREATED)


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
