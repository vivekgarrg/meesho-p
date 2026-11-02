"""
Return Scan — the returns desk.

The Meesho "Returns → Delivered" sheet (uploaded on Returns & Claims) says which
returns were delivered back on each day. That is the day's list here: scan each
returned parcel as it is unpacked and it is ticked off, so the desk can check
every return the sheet says came back really did — courier by courier, against
the sheet's own count.

Upcoming returns (still in transit on Meesho — out for delivery first, then by
expected date) can be scanned too, as the delivery boy hands them over: each is
then "verified", and waits there until Meesho marks it delivered, when it is
ticked off that day's list as received early. A return delivered on an earlier
day but never scanned is flagged as missing — the ones to raise a claim for.

Returns use calendar days: the sheet's Delivered Date is a calendar date.
"""

from datetime import timedelta

from django.db.models import Q as DQ
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .meesho_images import photo_map
from .models import LabelOrder, ReturnDelivery, ReturnScan

API_PATH = "return-scan/"
# How far back a delivered-but-never-received return is still flagged.
MISSING_DAYS = 15
# How long a damaged packet not yet raised with the delivery boy stays on the list.
DAMAGED_DAYS = 7
# How long a verified upcoming return waits for Meesho to mark it delivered.
VERIFIED_DAYS = 30
UPCOMING_LIMIT = 1000
OUT_FOR_DELIVERY = "out for delivery"
# How far back a code read short is matched by its AWB.
PARTIAL_DAYS = 60
MIN_PARTIAL = 8


def _views():
    from . import views
    return views


def _desk(request, business):
    return _views()._scan_desk_scope(request, business, api_path=API_PATH)


def _rto(row):
    return "rto" in (row.type_of_return or "").lower()


def _clean_courier(name):
    return " ".join((name or "").split()) or "No courier on sheet"


def _resolve(desk_ids, code):
    """The ReturnDelivery a scanned code belongs to, or None.

    Tried most specific first: the return's AWB, its packet id, the sub-order,
    the order number, the outbound label's AWB (an RTO often comes back under
    the AWB it went out on), then a partial AWB match over recent returns.
    Among several matches, one not received yet is preferred.
    """
    base = ReturnDelivery.objects.filter(business_id__in=desk_ids)

    def best(qs):
        rows = list(qs.order_by("-delivered_date", "-return_created_date")[:20])
        if not rows:
            return None
        received = set(ReturnScan.objects.filter(return_delivery__in=rows).values_list("return_delivery_id", flat=True))
        return next((r for r in rows if r.pk not in received), rows[0])

    for field in ("awb_number__iexact", "packet_id__iexact", "suborder_no__iexact", "order_no__iexact"):
        hit = best(base.filter(**{field: code}))
        if hit:
            return hit
    subs = list(LabelOrder.objects.filter(business_id__in=desk_ids, awb_number__iexact=code)
                .values_list("order_id", flat=True)[:5])
    if subs:
        hit = best(base.filter(suborder_no__in=subs))
        if hit:
            return hit
    if len(code) >= MIN_PARTIAL:
        since = timezone.localdate() - timedelta(days=PARTIAL_DAYS)
        hit = best(base.filter(DQ(awb_number__icontains=code) | DQ(suborder_no__icontains=code))
                   .filter(DQ(delivered_date__gte=since) | DQ(delivered_date__isnull=True)))
        if hit:
            return hit
    return None


def _item(r, names, image_map, scan=None, bucket="pending"):
    v = _views()
    return {
        "id": r.pk,
        "business_id": r.business_id,
        "business_name": names.get(r.business_id, ""),
        "suborder_no": r.suborder_no,
        "order_no": r.order_no,
        "awb": r.awb_number,
        "sku": r.sku,
        "qty": r.qty,
        "courier": _clean_courier(r.courier_partner),
        "rto": _rto(r),
        "type_of_return": r.type_of_return,
        "return_reason": r.return_reason,
        "stage": r.stage,
        "delivered_date": r.delivered_date.isoformat() if r.delivered_date else None,
        "expected_date": r.expected_delivery_date.isoformat() if r.expected_delivery_date else None,
        "transit_status": r.transit_status,
        "claim_status": r.claim_status,
        "image_url": image_map.get((r.business_id, r.suborder_no), (None, None))[0],
        "image_fallback_url": image_map.get((r.business_id, r.suborder_no), (None, None))[1],
        "scan_id": scan.pk if scan else None,
        "received_day": scan.scan_day.isoformat() if scan else None,
        "received_at": scan.last_scanned_at.isoformat() if scan else None,
        "scan_count": scan.scan_count if scan else 0,
        "bucket": bucket,
        **_damage(scan),
    }


def _due(r, day):
    """Where an upcoming return stands: out for delivery, overdue, due today, or later."""
    if (r.transit_status or "").strip().lower() == OUT_FOR_DELIVERY:
        return "out_for_delivery"
    if not r.expected_delivery_date:
        return "later"
    if r.expected_delivery_date < day:
        return "overdue"
    return "today" if r.expected_delivery_date == day else "later"


DUE_ORDER = {"out_for_delivery": 0, "overdue": 1, "today": 2, "later": 3}


def _damage(scan):
    """A scan's damaged / reported-to-the-delivery-boy marks."""
    if not scan:
        return {"damaged": False}
    return {"damaged": scan.damaged, "damage_note": scan.damage_note,
            "damaged_at": scan.damaged_at.isoformat() if scan.damaged_at else None,
            "reported_at": scan.reported_at.isoformat() if scan.reported_at else None}


def _scan_row(s, names, image_map):
    """A scan as a row — its return's details when it matched one, else what was scanned."""
    r = s.return_delivery
    if r:
        return _item(r, names, image_map, s, "received")
    return {"id": None, "scan_id": s.pk, "business_id": s.business_id, "business_name": names.get(s.business_id, ""),
            "suborder_no": s.suborder_no or s.scanned_code, "awb": s.awb_number or s.scanned_code, "sku": s.sku,
            "qty": s.qty, "courier": _clean_courier(s.courier_name) if s.courier_name else "Not recognised",
            "rto": False, "bucket": "extra", "why": "unknown", "received_day": s.scan_day.isoformat(),
            "received_at": s.last_scanned_at.isoformat(), "scan_count": s.scan_count, "image_url": None, **_damage(s)}


@api_view(["GET"])
def return_scan_queue(request, business_id):
    """
    The returns desk for one day (?date=YYYY-MM-DD, default today):

      expected   — returns the Delivered sheet says came back that day; each is
                   received (scanned) or still to receive
      extra      — parcels received that day that aren't on its list: early (the
                   sheet still has them in transit), from an earlier day's list,
                   or not recognised at all
      upcoming   — every return still in transit on Meesho, not yet received:
                   out for delivery first, then by expected date (`due`)
      verified   — upcoming returns scanned before Meesho marked them delivered,
                   waiting for it to (VERIFIED_DAYS)
      missing    — delivered on the sheet in the MISSING_DAYS before, never received

    Courier by courier: expected, received, left, and extra received.
    """
    v = _views()
    business = v.get_authorized_business(request, business_id)
    desk = _desk(request, business)
    ids = [b.pk for b in desk]
    names = {b.pk: b.name for b in desk}
    today = timezone.localdate()
    day = v._parse_day(request.GET.get("date")) or today

    expected = list(ReturnDelivery.objects.filter(business_id__in=ids, delivered_date=day)
                    .order_by("courier_partner", "sku")[:3000])
    day_scans = list(ReturnScan.objects.filter(business_id__in=ids, scan_day=day).select_related("return_delivery"))
    received = {s.return_delivery_id: s for s in
                ReturnScan.objects.filter(return_delivery__in=expected)} if expected else {}

    in_transit = list(ReturnDelivery.objects.filter(business_id__in=ids, stage=ReturnDelivery.STAGE_IN_TRANSIT)
                      .exclude(desk_scans__isnull=False).order_by("expected_delivery_date")[:UPCOMING_LIMIT])
    in_transit.sort(key=lambda r: (DUE_ORDER[_due(r, day)], r.expected_delivery_date or day, r.courier_partner or ""))
    verified = list(ReturnScan.objects.filter(business_id__in=ids, return_delivery__stage=ReturnDelivery.STAGE_IN_TRANSIT,
                                              scan_day__gte=day - timedelta(days=VERIFIED_DAYS), scan_day__lte=day)
                    .select_related("return_delivery").order_by("-last_scanned_at")[:500])
    missing = list(ReturnDelivery.objects.filter(
        business_id__in=ids, delivered_date__lt=day, delivered_date__gte=day - timedelta(days=MISSING_DAYS))
        .exclude(desk_scans__isnull=False).order_by("-delivered_date")[:1000])

    image_map = photo_map(expected + in_transit[:300] + missing
                          + [s.return_delivery for s in day_scans + verified if s.return_delivery])
    items = [_item(r, names, image_map, received.get(r.pk), "received" if r.pk in received else "pending")
             for r in expected]
    for i in items:                     # verified while still upcoming, before Meesho marked it delivered
        i["received_early"] = bool(i["received_day"] and i["delivered_date"] and i["received_day"] < i["delivered_date"])
    expected_ids = {r.pk for r in expected}

    couriers = {}

    def tile(name):
        return couriers.setdefault(name.casefold(), {"courier": name, "expected": 0, "received": 0, "left": 0, "extra": 0,
                                                     "verified": 0})

    extra = []
    verified_today = 0
    for s in day_scans:
        r = s.return_delivery
        if r and r.pk in expected_ids:
            continue
        if r and r.stage == ReturnDelivery.STAGE_IN_TRANSIT:
            verified_today += 1             # an upcoming return, verified — on the Verified list, not extra
            tile(_clean_courier(r.courier_partner))["verified"] += 1
            continue
        if r:
            why = ("early" if r.stage == ReturnDelivery.STAGE_IN_TRANSIT or not r.delivered_date
                   else "earlier" if r.delivered_date < day else "later")
            row = _item(r, names, image_map, s, "extra")
            row["why"] = why
        else:
            row = _scan_row(s, names, image_map)
        extra.append(row)

    for i in items:
        t = tile(i["courier"])
        t["expected"] += 1
        if i["bucket"] == "received":
            t["received"] += 1
        else:
            t["left"] += 1
    for e in extra:
        tile(e["courier"])["extra"] += 1

    summary = {
        "expected": len(items),
        "received": sum(1 for i in items if i["bucket"] == "received"),
        "left": sum(1 for i in items if i["bucket"] == "pending"),
        "extra": len(extra),
        "received_today": len(day_scans),
        "rto": sum(1 for i in items if i["rto"]),
        "customer": sum(1 for i in items if not i["rto"]),
        "in_transit": len(in_transit),
        "upcoming": len(in_transit),
        "out_for_delivery": sum(1 for r in in_transit if _due(r, day) == "out_for_delivery"),
        "upcoming_due": sum(1 for r in in_transit if _due(r, day) != "later"),
        "verified": len(verified),
        "verified_today": verified_today,
        "missing": len(missing),
        "damaged_today": sum(1 for s in day_scans if s.damaged),
        "by_courier": sorted(couriers.values(), key=lambda c: (-(c["expected"] + c["extra"] + c["verified"]), c["courier"])),
    }
    # Damaged packets: the day's, and any earlier one not yet raised with the
    # delivery boy — grouped by courier on screen for the evening.
    damaged = list(ReturnScan.objects.filter(business_id__in=ids, damaged=True)
                   .filter(DQ(scan_day=day) | DQ(reported_at__isnull=True, scan_day__gte=day - timedelta(days=DAMAGED_DAYS),
                                                 scan_day__lte=day))
                   .select_related("return_delivery").order_by("courier_name", "-last_scanned_at")[:300])
    damaged_rows = [{**_scan_row(s, names, photo_map([s.return_delivery]) if s.return_delivery else {}), "bucket": "damaged"}
                    for s in damaged]
    summary["damaged"] = len(damaged_rows)
    summary["damaged_unreported"] = sum(1 for d in damaged_rows if not d["reported_at"])
    dates = set(ReturnDelivery.objects.filter(business_id__in=ids, delivered_date__lte=today)
                .values_list("delivered_date", flat=True).distinct().order_by("-delivered_date")[:14])
    dates |= {today, today - timedelta(days=1)}
    return Response({
        "date": day.isoformat(),
        "today": today.isoformat(),
        "is_admin": v._is_admin(request.user),
        "businesses": [{"id": b.pk, "name": b.name} for b in desk],
        "summary": summary,
        "items": items,
        "extra": extra,
        "upcoming": [{**_item(r, names, image_map, None, "upcoming"), "due": _due(r, day)} for r in in_transit[:300]],
        "verified": [_item(s.return_delivery, names, image_map, s, "verified") for s in verified],
        "missing": [_item(r, names, image_map, None, "missing") for r in missing[:300]],
        "damaged": damaged_rows,
        "dates": [d.isoformat() for d in sorted((d for d in dates if d), reverse=True)],
    })


@api_view(["POST"])
def return_scan_record(request, business_id):
    """
    Record one returned parcel received at the desk.

    Body: {"code": "...", "day": "YYYY-MM-DD" (optional — a day picked on
    screen; default today)}. A code matching a return links to it (a re-scan
    bumps the count, and keeps the day it was first received); one matching
    nothing is still saved, under the business on screen.
    """
    v = _views()
    business = v.get_authorized_business(request, business_id)
    data = request.data if isinstance(request.data, dict) else {}
    code = v._order_scan_code(data.get("code"))
    if not code:
        return Response({"error": "Nothing scanned."}, status=status.HTTP_400_BAD_REQUEST)
    if len(code) > 150:
        return Response({"error": "That code is too long to be a barcode."}, status=status.HTTP_400_BAD_REQUEST)
    today = timezone.localdate()
    day = today
    if data.get("day"):
        day = v._parse_day(str(data["day"]))
        if not day:
            return Response({"error": "day must be YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST)
        if day > today:
            return Response({"error": "That day hasn't come yet."}, status=status.HTTP_400_BAD_REQUEST)

    desk = _desk(request, business)
    ids = [b.pk for b in desk]
    names = {b.pk: b.name for b in desk}
    now = timezone.now()
    r = _resolve(ids, code)

    if r:
        scan = ReturnScan.objects.filter(return_delivery=r).first()
        again = bool(scan)
        if scan:
            scan.scan_count += 1
            scan.last_scanned_at = now
            scan.scanned_by = request.user
            scan.scanned_code = code
            scan.save(update_fields=["scan_count", "last_scanned_at", "scanned_by", "scanned_code"])
        else:
            scan = ReturnScan.objects.create(
                business_id=r.business_id, return_delivery=r, scanned_code=code, suborder_no=r.suborder_no,
                awb_number=r.awb_number, courier_name=_clean_courier(r.courier_partner), sku=r.sku, qty=r.qty or 1,
                scan_day=day, last_scanned_at=now, scanned_by=request.user,
            )
        if r.delivered_date == scan.scan_day:
            where = "on_list"
        elif r.stage == ReturnDelivery.STAGE_IN_TRANSIT or not r.delivered_date:
            where = "in_transit"
        elif r.delivered_date < scan.scan_day:
            where = "earlier"
        else:
            where = "later"
        if "damaged" in data:                       # flagged damaged as it was scanned
            _mark(scan, data, request.user)
        item = _item(r, names, photo_map([r]), scan, "received" if where == "on_list" else "extra")
        return Response({"matched": True, "already_scanned": again, "where": where, "item": item},
                        status=status.HTTP_200_OK if again else status.HTTP_201_CREATED)

    scan = ReturnScan.objects.filter(business_id__in=ids, return_delivery__isnull=True, scanned_code__iexact=code).first()
    if scan:
        scan.scan_count += 1
        scan.last_scanned_at = now
        scan.save(update_fields=["scan_count", "last_scanned_at"])
    else:
        scan = ReturnScan.objects.create(business=business, scanned_code=code, suborder_no=code, scan_day=day,
                                         last_scanned_at=now, scanned_by=request.user)
    if "damaged" in data:
        _mark(scan, data, request.user)
    return Response({"matched": False, "already_scanned": scan.scan_count > 1, "where": "unknown",
                     "item": {"scan_id": scan.pk, "suborder_no": code, "awb": code, "courier": "Not recognised",
                              "bucket": "extra", "why": "unknown", "received_day": scan.scan_day.isoformat(),
                              "scan_count": scan.scan_count, **_damage(scan)}}, status=status.HTTP_201_CREATED)


def _mark(scan, data, user):
    """Apply {damaged?, note?, reported?} to a scan."""
    now = timezone.now()
    fields = []
    if "damaged" in data:
        on = bool(data.get("damaged"))
        if on and not scan.damaged:
            scan.damaged, scan.damaged_at, scan.damaged_by = True, now, user
        elif not on:
            scan.damaged, scan.damaged_at, scan.damaged_by, scan.reported_at, scan.reported_by = False, None, None, None, None
        fields += ["damaged", "damaged_at", "damaged_by", "reported_at", "reported_by"]
    if "note" in data:
        scan.damage_note = str(data.get("note") or "").strip()[:200]
        fields.append("damage_note")
    if "reported" in data and scan.damaged:
        on = bool(data.get("reported"))
        scan.reported_at, scan.reported_by = (now, user) if on else (None, None)
        fields += ["reported_at", "reported_by"]
    if fields:
        scan.save(update_fields=list(dict.fromkeys(fields)))


@api_view(["PATCH", "DELETE"])
def return_scan_delete(request, business_id, pk):
    """
    PATCH {damaged?, note?, reported?} — mark a received packet damaged /
    tampered (with a note), or as raised with the delivery boy.
    DELETE — undo a mis-scan: the parcel goes back to "to receive" (the return
    itself is untouched).
    """
    v = _views()
    business = v.get_authorized_business(request, business_id)
    ids = [b.pk for b in _desk(request, business)]
    if request.method == "PATCH":
        scan = ReturnScan.objects.filter(pk=pk, business_id__in=ids).select_related("return_delivery").first()
        if not scan:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        _mark(scan, request.data if isinstance(request.data, dict) else {}, request.user)
        return Response({"scan_id": scan.pk, **_damage(scan)})
    n, _ = ReturnScan.objects.filter(pk=pk, business_id__in=ids).delete()
    if not n:
        return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response({"deleted": True})
