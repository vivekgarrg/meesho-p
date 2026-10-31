"""
Meesho returns and delivery OTPs, from the panel's Returns page.

The sync worker (MeeshoReturnsJob, every 10 minutes) reads each return status
— in transit, out for delivery, delivered, lost, disposed — and the couriers'
delivery OTPs into snapshots. This module is the go-between: `normalize` turns
each Meesho return into the row shape of the Returns export the Returns &
Claims page imports, and `sync_account` writes them through that same importer
(views.upsert_return_rows) — so a return synced and a return uploaded are the
same row, and neither can overwrite claim work.

The OTPs are served to Meesho → Returns & OTPs, across every business on the
desk, straight from the last read.
"""

from django.db.models import Count
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import MeeshoAccount, MeeshoSyncSnapshot, ReturnDelivery

# Meesho's return status (its "shipment_status" filter) → the import kind, our
# words for it, and the date field that closes it. Written in this order, so
# a return that moved on between two reads ends in its latest state.
STATUSES = [
    ("intransit", "in_transit", "In transit"),
    ("ofd_reverse", "in_transit", "Out for delivery"),
    ("completed_lost", "lost", "Lost"),
    ("reverse_disposed", "disposed", "Disposed"),
    ("completed_delivered", "delivered", "Delivered"),
]
SNAPSHOT = "returns_{}"
OTP_SNAPSHOT = "delivery_otps"
RETURN_TYPES = {"RTO": "Courier Return (RTO)", "RET": "Customer Return"}


def _v(x):
    """A value as the importer wants it: None for missing, never ''."""
    return x if x not in ("", None, {}, []) else None


def normalize(r, meesho_status):
    """One Meesho return (fetchReturnClaims data row) → a Returns export row."""
    product = r.get("product") or {}
    reasons = r.get("return_reason_details") or {}
    attempt = r.get("ofd_reverse_attempt") or {}
    pod = r.get("proof_of_delivery") or {}
    row = {
        "synced": True,
        "suborder_no": _v(r.get("sub_order_num")), "order_no": _v(r.get("order_num")), "awb_number": _v(r.get("awb")),
        "product_name": _v(product.get("name")), "sku": _v(product.get("sku")), "variation": _v(product.get("variation")),
        "meesho_pid": _v(product.get("meesho_pid")), "category": _v(product.get("category")), "qty": product.get("quantity"),
        "dispatch_date": _v(r.get("order_dispatch_date_iso")), "return_created_date": _v(r.get("created_date_iso")),
        "type_of_return": RETURN_TYPES.get(r.get("type"), _v(r.get("type"))), "sub_type": _v(r.get("sub_type")),
        "courier_partner": _v(r.get("carrier_name")), "tracking_link": _v(r.get("tracking_url")),
        "return_price_type": _v(r.get("return_price_type")),
        "return_reason": _v(reasons.get("return_reason")), "detailed_return_reason": _v(reasons.get("detailed_reason")),
        "meesho_status": _v(r.get("shipment_status")),
        "delivery_attempts": attempt.get("reverse_ofd_attempt_count_value"),
    }
    if meesho_status in ("intransit", "ofd_reverse"):
        row.update({
            "transit_status": "Out for delivery" if meesho_status == "ofd_reverse" else _v(r.get("shipment_status")),
            "expected_delivery_date": _v(r.get("expected_delivery_date_iso")),
            "delivery_attempt": _v(attempt.get("reverse_ofd_attempt_count_label")),
        })
    elif meesho_status == "completed_delivered":
        row.update({
            "delivered_date": _v(r.get("delivered_date_iso")),
            "proof_of_delivery": _v(pod.get("digital_pod_url")) or _v(pod.get("label")),
            "otp_verified_at": _v(pod.get("otp_verified_time")),
        })
    elif meesho_status == "completed_lost":
        row.update({"closed_at": _v(r.get("lost_date_iso")), "meesho_note": _v(r.get("payment_status"))})
    elif meesho_status == "reverse_disposed":
        row["closed_at"] = _v(r.get("disposed_date_iso"))
    return row


def sync_account(account):
    """Write the account's last-read returns into ReturnDelivery. Returns counts per status."""
    from . import views
    snaps = {s.endpoint: s for s in MeeshoSyncSnapshot.objects.filter(
        account=account, endpoint__in=[SNAPSHOT.format(st) for st, _, _ in STATUSES])}
    out = {}
    now = timezone.now()
    for meesho_status, kind, _label in STATUSES:
        snap = snaps.get(SNAPSHOT.format(meesho_status))
        if not snap or not isinstance(snap.payload, list):
            continue
        rows = [normalize(r, meesho_status) for r in snap.payload if isinstance(r, dict)]
        out[meesho_status] = views.upsert_return_rows(account.business, rows, kind, now=now)
    return out


# ── API: Meesho → Returns & OTPs ──────────────────────────────────────────────

def _views():
    from . import views
    return views


@api_view(["GET"])
def returns_dashboard(request, business_id):
    """
    Every courier's delivery OTP for every business on this desk (as the
    Returns page shows them), and the returns by status.
    """
    from .meesho_sync import _desk_accounts, KIND_RETURNS, _run_json
    business = _views().get_authorized_business(request, business_id)
    _desk, accounts = _desk_accounts(request, business)
    names = {a.pk: a.business.name for a in accounts}
    now = timezone.now()
    otps = []
    fetched = {}
    for snap in MeeshoSyncSnapshot.objects.filter(account__in=accounts, endpoint=OTP_SNAPSHOT):
        fetched[snap.account_id] = snap.fetched_at
        for o in (snap.payload or {}).get("supplier_delivery_otp") or [] if isinstance(snap.payload, dict) else []:
            details = [d for d in o.get("otp_details") or [] if isinstance(d, dict)]
            active = next((d for d in details if d.get("active")), details[0] if details else {})
            expiry = active.get("expiry_timestamp") or o.get("otp_expiry_timestamp")
            otps.append({
                "business_id": next(a.business_id for a in accounts if a.pk == snap.account_id),
                "business_name": names[snap.account_id],
                "courier": (o.get("carrier_details") or {}).get("name") or o.get("carrier_name") or "",
                "courier_icon": (o.get("carrier_details") or {}).get("icon") or "",
                "otp": active.get("otp") or o.get("otp") or "", "expires_at": expiry,
                "kind": active.get("display_text") or "OTP",
                "shipments": o.get("count") or (o.get("delivery_shipment_details") or {}).get("total_shipment_count") or 0,
                "awbs": [a for a in o.get("awbs") or [] if a],
                "fetched_at": snap.fetched_at,
            })
    otps.sort(key=lambda x: (x["business_name"], x["courier"]))

    biz_ids = [a.business_id for a in accounts]
    by_stage = {r["stage"]: r["n"] for r in ReturnDelivery.objects.filter(business_id__in=biz_ids)
                .values("stage").annotate(n=Count("id"))}
    out_for_delivery = ReturnDelivery.objects.filter(business_id__in=biz_ids, stage=ReturnDelivery.STAGE_IN_TRANSIT,
                                                     transit_status="Out for delivery").count()
    meesho_counts = {}
    for snap in MeeshoSyncSnapshot.objects.filter(account__in=accounts, endpoint__startswith="returns_"):
        st = snap.endpoint[len("returns_"):]
        meesho_counts[st] = meesho_counts.get(st, 0) + (len(snap.payload) if isinstance(snap.payload, list) else 0)
    runs = []
    for a in accounts:
        last = a.runs.filter(kind=KIND_RETURNS).first()
        runs.append({"business_id": a.business_id, "business_name": a.business.name,
                     "last_run": _run_json(last) if last else None, "otps_read_at": fetched.get(a.pk)})
    return Response({
        "otps": otps, "now": now,
        "returns": {
            "in_transit": by_stage.get(ReturnDelivery.STAGE_IN_TRANSIT, 0) - out_for_delivery,
            "out_for_delivery": out_for_delivery,
            "delivered": by_stage.get(ReturnDelivery.STAGE_DELIVERED, 0),
            "lost": by_stage.get(ReturnDelivery.STAGE_LOST, 0),
            "disposed": by_stage.get(ReturnDelivery.STAGE_DISPOSED, 0),
        },
        "last_read": meesho_counts, "accounts": runs,
    })


@api_view(["POST"])
def returns_refresh(request, business_id):
    """Read every combined business's returns and OTPs from Meesho now."""
    from .meesho_sync import _desk_accounts, _queue_run, KIND_RETURNS, SyncNotConfigured
    from .models import MeeshoSyncRun
    business = _views().get_authorized_business(request, business_id)
    _desk, accounts = _desk_accounts(request, business)
    live = [a for a in accounts if a.status == MeeshoAccount.STATUS_ACTIVE]
    if not live:
        return Response({"error": "No connected Meesho account here."}, status=status.HTTP_400_BAD_REQUEST)
    queued = 0
    try:
        for a in live:
            _, fresh = _queue_run(a, KIND_RETURNS, MeeshoSyncRun.TRIGGER_MANUAL)
            queued += fresh
    except SyncNotConfigured as exc:
        return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({"queued": queued}, status=status.HTTP_202_ACCEPTED)


# Meesho → Returns & OTPs → the returns table, one status at a time.
LIST_STAGES = {
    "in_transit": lambda qs: qs.filter(stage=ReturnDelivery.STAGE_IN_TRANSIT).exclude(transit_status="Out for delivery"),
    "out_for_delivery": lambda qs: qs.filter(stage=ReturnDelivery.STAGE_IN_TRANSIT, transit_status="Out for delivery"),
    "delivered": lambda qs: qs.filter(stage=ReturnDelivery.STAGE_DELIVERED),
    "lost": lambda qs: qs.filter(stage=ReturnDelivery.STAGE_LOST),
    "disposed": lambda qs: qs.filter(stage=ReturnDelivery.STAGE_DISPOSED),
}
LIST_ORDER = {
    "in_transit": ("expected_delivery_date", "-return_created_date"),
    "out_for_delivery": ("-delivery_attempts", "-return_created_date"),
    "delivered": ("-delivered_date", "-id"),
    "lost": ("-closed_at", "-id"),
    "disposed": ("-closed_at", "-id"),
}
LIST_PAGE = 50


@api_view(["GET"])
def returns_list(request, business_id):
    """
    Every return in one status, for every business on this desk:
    ?stage=in_transit|out_for_delivery|delivered|lost|disposed, ?q= (sub-order,
    order, AWB, SKU, product, courier), ?business=, ?page=.
    """
    from django.db.models import Q
    from .meesho_sync import _desk_accounts
    business = _views().get_authorized_business(request, business_id)
    desk, _accounts = _desk_accounts(request, business)
    stage = request.GET.get("stage") or "in_transit"
    if stage not in LIST_STAGES:
        return Response({"error": "Unknown status."}, status=status.HTTP_400_BAD_REQUEST)
    ids = [b.pk for b in desk]
    if request.GET.get("business", "").isdigit() and int(request.GET["business"]) in ids:
        ids = [int(request.GET["business"])]
    qs = LIST_STAGES[stage](ReturnDelivery.objects.filter(business_id__in=ids)).select_related("business")
    q = (request.GET.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(suborder_no__icontains=q) | Q(order_no__icontains=q) | Q(awb_number__icontains=q) | Q(sku__icontains=q)
                       | Q(product_name__icontains=q) | Q(courier_partner__icontains=q))
    try:
        page = max(1, int(request.GET.get("page") or 1))
    except ValueError:
        page = 1
    total = qs.count()
    rows = qs.order_by(*LIST_ORDER[stage])[(page - 1) * LIST_PAGE: page * LIST_PAGE]
    return Response({"stage": stage, "total": total, "page": page, "page_size": LIST_PAGE, "returns": [{
        "id": r.pk, "business_name": r.business.name, "suborder_no": r.suborder_no, "order_no": r.order_no,
        "awb": r.awb_number, "sku": r.sku, "product": r.product_name, "variation": r.variation, "qty": r.qty,
        "type": r.type_of_return, "sub_type": r.sub_type, "courier": r.courier_partner, "tracking_link": r.tracking_link,
        "meesho_status": r.meesho_status or r.transit_status, "attempts": r.delivery_attempts or r.delivery_attempt or None,
        "dispatch_date": r.dispatch_date, "created": r.return_created_date, "expected": r.expected_delivery_date,
        "delivered": r.delivered_date, "closed_at": r.closed_at, "note": r.meesho_note,
        "reason": r.return_reason, "detailed_reason": r.detailed_return_reason, "price_type": r.return_price_type,
        "proof_of_delivery": r.proof_of_delivery, "otp_verified_at": r.otp_verified_at,
        "claim_status": r.claim_status, "claim_label": r.get_claim_status_display(),
        "synced_at": r.synced_at,
    } for r in rows]})
