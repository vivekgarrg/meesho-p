"""
Returns middleware: the Meesho panel's returns (as the sync worker last read
them — snapshots returns_<status>, fetchReturnClaims rows) → the returns table
(ReturnDelivery), through the Returns export's own importer
(views.upsert_return_rows), so a synced return and an uploaded one are the
same row:

  · each Meesho return is put in the export's row shape (normalize);
  · rows without a sub-order number are rejected (one without an AWB is kept,
    keyed on the sub-order, as the export does — and counted);
  · claim work is never overwritten, a delivered return never goes back to in
    transit, and lost / disposed ones stay out of the claim workload.
"""

from django.utils import timezone

from ..models import MeeshoSyncSnapshot
from .base import Result, deferred_bumps, missing

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
    return inject(account).as_dict()


def inject(account):
    """The returns middleware for one account: normalize, validate, write. Returns a Result."""
    from .. import views
    snaps = {s.endpoint: s for s in MeeshoSyncSnapshot.objects.filter(
        account=account, endpoint__in=[SNAPSHOT.format(st) for st, _, _ in STATUSES])}
    res = Result()
    now = timezone.now()
    with deferred_bumps(account.business_id):
        for meesho_status, kind, _label in STATUSES:
            snap = snaps.get(SNAPSHOT.format(meesho_status))
            if not snap or not isinstance(snap.payload, list):
                continue
            rows = []
            for r in snap.payload:
                if not isinstance(r, dict):
                    res.reject("not a return", r)
                    continue
                row = normalize(r, meesho_status)
                if missing(row, "suborder_no"):
                    res.reject("missing sub-order number", r)
                    continue
                if missing(row, "awb_number"):
                    res.add("without_awb")
                rows.append(row)
            counts = views.upsert_return_rows(account.business, rows, kind, now=now)
            res.counts[meesho_status] = counts
            res.add("created", counts["created"])
            res.add("updated", counts["updated"])
    return res


