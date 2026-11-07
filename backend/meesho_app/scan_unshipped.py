"""
Order Scan → Unshipped: every Meesho parcel scanned (or linked) at the desk
that Meesho hasn't shipped yet — across days, oldest first — and the ones that
have gone since. A parcel leaves the list the moment Meesho shows it shipped.

Where a scan stands is settled from what the Meesho sync last read, every time
the sync writes Meesho's orders (management/commands/meesho_inject) and every
time this screen is read:

  * Meesho's Shipped list (by AWB)          → shipped
  * Meesho's Cancelled list (by sub-order)  → cancelled
  * the orders table / payments sheet       → the furthest status either gives
    (each sync writes Meesho's tabs into the orders table, so this is as fresh)

A scan's ship status only ever moves forward (never from shipped back to "not
shipped"), and a packed parcel that ships is marked dispatched — as Order
linking's mark_shipped does for linked ones.
"""

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import LabelOrder, MeeshoAccount, MeeshoPacketLink, ScannedOrder

# How far back a scan can still be waiting. Older ones are out of Meesho's lists, and of this screen.
DAYS = 15
# How long a shipped parcel is still shown under "Gone".
GONE_HOURS = 24
S = ScannedOrder
WAITING = (S.STATUS_SCANNED, S.STATUS_PACKED, S.STATUS_DISPATCHED, S.STATUS_ON_HOLD, S.STATUS_ISSUE)
DONE = (S.SHIP_SHIPPED, S.SHIP_RETURNED, S.SHIP_CANCELLED)


def _views():
    from . import views
    return views


def _lists(accounts):
    from .meesho_linking import _awbs_in, _cancelled_subs
    return (_awbs_in(accounts, "orders_ready_to_ship"), _awbs_in(accounts, "orders_shipped"), _cancelled_subs(accounts))


def settle(business_ids, accounts=None, scans=None):
    """
    Bring the Meesho scans of these businesses (scanned in the last DAYS days,
    not settled yet) up to what Meesho shows now. Returns how many changed.
    """
    from .meesho_linking import _clean as clean
    v = _views()
    accounts = accounts if accounts is not None else list(MeeshoAccount.objects.filter(business_id__in=business_ids))
    if scans is None:
        scans = list(S.objects.filter(business_id__in=business_ids, platform="meesho",
                                      last_scanned_at__gte=timezone.now() - timedelta(days=DAYS))
                     .exclude(ship_status__in=DONE))
    else:
        scans = [s for s in scans if s.ship_status not in DONE]
    if not scans:
        return 0
    _rts, shipped, cancelled = _lists(accounts)
    sheets = v._sheet_status_raws(business_ids, [s.sub_order_no for s in scans])
    now = timezone.now()
    changed = 0
    for s in scans:
        raw = sheets.get((s.business_id, s.sub_order_no)) or ""
        best, best_raw = S.classify_ship_status(raw), raw
        if s.sub_order_no and (s.business_id, s.sub_order_no) in cancelled and v._SHIP_PRIORITY[S.SHIP_CANCELLED] > v._SHIP_PRIORITY[best]:
            best, best_raw = S.SHIP_CANCELLED, "CANCELLED (Meesho)"
        if s.awb_number and clean(s.awb_number) in shipped and v._SHIP_PRIORITY[S.SHIP_SHIPPED] > v._SHIP_PRIORITY[best]:
            best, best_raw = S.SHIP_SHIPPED, "SHIPPED (Meesho)"
        if v._SHIP_PRIORITY[best] <= v._SHIP_PRIORITY[s.ship_status]:
            continue
        s.ship_status, s.ship_status_raw = best, best_raw[:100]
        fields = ["ship_status", "ship_status_raw", "updated_at"]
        if best in (S.SHIP_SHIPPED, S.SHIP_RETURNED) and s.status in (S.STATUS_PACKED, S.STATUS_SCANNED):
            s.status, s.status_updated_at = S.STATUS_DISPATCHED, now
            fields += ["status", "status_updated_at"]
        s.save(update_fields=fields)
        changed += 1
    return changed


@api_view(["GET"])
def unshipped(request, business_id):
    """
    GET — the desk's Meesho parcels scanned and not shipped yet (oldest first), the ones
    gone in the last GONE_HOURS hours, and those cancelled after packing; per courier.
    Settles every scan against Meesho's lists first (see settle).
    """
    from .meesho_images import photo_map
    from .meesho_linking import _checked_at, _clean, _courier_names, _syncing
    v = _views()
    business = v.get_authorized_business(request, business_id)
    desk = v._scan_desk_scope(request, business)
    ids = [b.pk for b in desk]
    names = {b.pk: b.name for b in desk}
    accounts = list(MeeshoAccount.objects.filter(business_id__in=ids))
    now = timezone.now()
    scans = list(S.objects.filter(business_id__in=ids, platform="meesho", last_scanned_at__gte=now - timedelta(days=DAYS))
                 .filter(Q(status__in=WAITING) | Q(status=S.STATUS_CANCELLED))
                 .order_by("scan_day", "last_scanned_at")[:5000])
    settle(ids, accounts, scans)
    rts, _shipped, _cancelled = _lists(accounts)
    links = {}
    for l in MeeshoPacketLink.objects.filter(business_id__in=ids, awb_number__in=[_clean(s.awb_number) for s in scans if s.awb_number]):
        links[(l.business_id, l.awb_number)] = l
    couriers_by_id = _courier_names()
    today = v._current_business_date()

    def state(s):
        if s.ship_status in (S.SHIP_SHIPPED, S.SHIP_RETURNED):
            return "gone"
        if s.ship_status == S.SHIP_CANCELLED or s.status == S.STATUS_CANCELLED:
            return "cancelled"
        return "unshipped"

    rows, summary, by_courier = [], {"unshipped": 0, "gone": 0, "cancelled": 0, "ready_to_ship": 0, "not_on_lists": 0, "old": 0}, {}
    gone_since = now - timedelta(hours=GONE_HOURS)
    for s in scans:
        st = state(s)
        if st != "unshipped" and (s.updated_at or now) < gone_since:
            continue                                            # gone a while ago: off the screen
        awb = _clean(s.awb_number)
        link = links.get((s.business_id, awb))
        courier = " ".join((s.courier_name or (link.courier_name if link else "") or
                            (couriers_by_id.get(link.carrier_id, "") if link else "")).split()) or "Courier not known"
        on_meesho = "ready_to_ship" if awb and awb in rts else "not_on_lists"
        age = (today - s.scan_day).days if s.scan_day else 0
        summary[st] += 1
        c = by_courier.setdefault(courier.casefold(), {"courier": courier, "unshipped": 0, "gone": 0, "cancelled": 0})
        c[st] += 1
        if st == "unshipped":
            summary[on_meesho] += 1
            if age >= 1:
                summary["old"] += 1
        rows.append({"id": s.pk, "business_id": s.business_id, "business_name": names.get(s.business_id, ""),
                     "sub_order_no": s.sub_order_no, "awb": awb, "sku": s.sku, "size": s.size, "qty": s.qty or 1,
                     "courier": courier, "state": st, "on_meesho": on_meesho if st == "unshipped" else None,
                     "status": s.status, "ship_status": s.ship_status, "ship_status_raw": s.ship_status_raw,
                     "scan_day": s.scan_day, "age_days": age, "scanned_at": s.last_scanned_at, "changed_at": s.updated_at,
                     "packet_id": link.packet_id if link else None})
    # Photos for what's on screen (the unshipped first).
    labels = {}
    subs = [r["sub_order_no"] for r in sorted(rows, key=lambda r: r["state"] != "unshipped") if r["sub_order_no"]][:600]
    for l in LabelOrder.objects.filter(business_id__in=ids, order_id__in=subs).order_by("uploaded_date"):
        labels[(l.business_id, l.order_id)] = l
    try:
        photos = photo_map(list(labels.values()), sub_of=lambda l: l.order_id, own=lambda l: "") if labels else {}
    except Exception:                                          # noqa: BLE001 — photos never stop the list
        photos = {}
    for r in rows:
        r["image_url"], r["image_fallback_url"] = photos.get((r["business_id"], r["sub_order_no"]), (None, None))
    rows.sort(key=lambda r: ({"unshipped": 0, "gone": 1, "cancelled": 2}[r["state"]],
                             -(r["age_days"] or 0) if r["state"] == "unshipped" else 0,
                             r["courier"], str(r["changed_at"] if r["state"] != "unshipped" else r["scanned_at"])))
    return Response({
        "summary": summary,
        "by_courier": sorted(by_courier.values(), key=lambda c: (-c["unshipped"], c["courier"])),
        "rows": rows, "days": DAYS, "gone_hours": GONE_HOURS,
        "checked_at": _checked_at(accounts), "syncing": _syncing(accounts), "at": now,
    })
