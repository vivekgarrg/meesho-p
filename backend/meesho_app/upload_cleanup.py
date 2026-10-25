"""
Clean up a wrong upload: list the payment / order uploads by when they were
made, and remove the rows one of them added.

Nothing records an "upload" as such, but every row stamps when it was first
saved, and one upload saves all its rows within a few minutes. So the uploads
are rebuilt by grouping those stamps: a gap of more than UPLOAD_GAP between
two saved rows starts a new upload.

Only rows an upload *added* can be removed this way. A row it updated in place
(the same order uploaded again) keeps its original stamp — uploading the
correct file again puts those values right.
"""

from datetime import timedelta

from django.db import transaction
from django.db.models import Max, Min
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import (
    AdsCost, CompensationRecovery, FlipkartOrder, FlipkartOrderPayment, FlipkartOtherCharge,
    Order, OrderPayment, ReferralPayment,
)

UPLOAD_GAP = timedelta(minutes=5)
MAX_UPLOADS = 60

# dataset -> (label, [(model, stamp field, what the rows are, date field shown or None)])
DATASETS = {
    "meesho_payments": ("Meesho payment file", [
        (OrderPayment, "uploaded_at", "Order payments", "payment_date"),
        (AdsCost, "uploaded_at", "Ads cost", None),
        (ReferralPayment, "uploaded_at", "Referral payments", None),
        (CompensationRecovery, "uploaded_at", "Compensation & recovery", None),
    ]),
    "meesho_orders": ("Meesho orders CSV", [
        (Order, "created_at", "Orders", "order_date"),
    ]),
    "flipkart_payments": ("Flipkart settlement report", [
        (FlipkartOrderPayment, "uploaded_at", "Order items", "payment_date"),
        (FlipkartOtherCharge, "uploaded_at", "Ads / fines / other charges", None),
    ]),
    "flipkart_orders": ("Flipkart orders report", [
        (FlipkartOrder, "uploaded_at", "Order items", "order_date"),
    ]),
}


def _uploads(business, key, since):
    """The uploads of one dataset since `since`, newest first."""
    label, tables = DATASETS[key]
    stamps = []
    for model, field, what, _ in tables:
        qs = model.objects.filter(business=business, **{f"{field}__gte": since}).values_list(field, flat=True)
        stamps += [(ts, what) for ts in qs.iterator(chunk_size=5000) if ts]
    stamps.sort(key=lambda s: s[0])

    groups = []
    for ts, what in stamps:
        if groups and ts - groups[-1]["end"] <= UPLOAD_GAP:
            g = groups[-1]
            g["end"] = ts
        else:
            g = {"start": ts, "end": ts, "counts": {}}
            groups.append(g)
        g["counts"][what] = g["counts"].get(what, 0) + 1

    out = []
    for g in reversed(groups[-MAX_UPLOADS:]):
        dates = None
        model, field, _, date_field = tables[0]
        if date_field:
            agg = model.objects.filter(business=business, **{f"{field}__gte": g["start"], f"{field}__lte": g["end"]}) \
                .aggregate(lo=Min(date_field), hi=Max(date_field))
            if agg["lo"]:
                lo, hi = agg["lo"], agg["hi"]
                dates = {"from": (lo.date() if hasattr(lo, "date") else lo).isoformat(),
                         "to": (hi.date() if hasattr(hi, "date") else hi).isoformat()}
        out.append({
            "dataset": key,
            "dataset_label": label,
            "start": g["start"].isoformat(),
            "end": g["end"].isoformat(),
            "rows": sum(g["counts"].values()),
            "counts": [{"label": k, "rows": v} for k, v in g["counts"].items()],
            "dates": dates,
            "date_field": date_field.replace("_", " ") if date_field else None,
        })
    return out


@api_view(["GET"])
def upload_cleanup_list(request, business_id):
    """
    Every payment / order upload of this business in the last `days` days
    (default 90, at most 730), newest first, with what each one added.
    Query: dataset (one key of DATASETS) to narrow it, days.
    """
    from .views import _is_admin, get_authorized_business
    business = get_authorized_business(request, business_id)
    try:
        days = min(730, max(1, int(request.GET.get("days", 90))))
    except (TypeError, ValueError):
        days = 90
    since = timezone.now() - timedelta(days=days)
    wanted = request.GET.get("dataset")
    keys = [wanted] if wanted in DATASETS else list(DATASETS)
    uploads = []
    for key in keys:
        uploads += _uploads(business, key, since)
    uploads.sort(key=lambda u: u["end"], reverse=True)
    return Response({
        "days": days,
        "can_delete": _is_admin(request.user),
        "datasets": [{"key": k, "label": v[0]} for k, v in DATASETS.items()],
        "uploads": uploads,
    })


@api_view(["POST"])
def upload_cleanup_delete(request, business_id):
    """
    Admin only: remove the rows one upload added.
    Body: {"dataset": key, "start": iso, "end": iso} — as listed by
    upload_cleanup_list. Every table of that dataset loses the rows this
    business saved between start and end, inclusive.
    """
    from .views import _is_admin, get_authorized_business
    business = get_authorized_business(request, business_id)
    if not _is_admin(request.user):
        return Response({"error": "Only an admin can remove uploaded data."}, status=status.HTTP_403_FORBIDDEN)
    data = request.data if isinstance(request.data, dict) else {}
    key = data.get("dataset")
    start = parse_datetime(str(data.get("start") or ""))
    end = parse_datetime(str(data.get("end") or ""))
    if key not in DATASETS or not start or not end or end < start:
        return Response({"error": "Choose an upload to remove (dataset, start and end)."},
                        status=status.HTTP_400_BAD_REQUEST)
    if end - start > timedelta(hours=6):
        return Response({"error": "That's longer than one upload — remove uploads one at a time."},
                        status=status.HTTP_400_BAD_REQUEST)

    removed = []
    with transaction.atomic():
        for model, field, what, _ in DATASETS[key][1]:
            n, _ = model.objects.filter(business=business, **{f"{field}__gte": start, f"{field}__lte": end}).delete()
            removed.append({"label": what, "rows": n})
    return Response({
        "dataset": key,
        "dataset_label": DATASETS[key][0],
        "removed": removed,
        "rows": sum(r["rows"] for r in removed),
    })
