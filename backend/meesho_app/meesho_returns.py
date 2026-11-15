"""
Meesho returns and delivery OTPs, from the panel's Returns page — the API of
Meesho → Returns & OTPs. The sync worker (MeeshoReturnsJob) reads them into
snapshots; the returns middleware (sync_middleware/returns.py) writes them into
the returns table. The OTPs are served straight from the last read.
"""

from django.db.models import Count
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .meesho_images import photo_map
from .models import MeeshoAccount, MeeshoSyncSnapshot, ReturnDelivery

from .sync_middleware.returns import (OTP_SNAPSHOT, SNAPSHOT, STATUSES, normalize,  # noqa: F401 — the middleware
                                     sync_account)

# ── API: Meesho → Returns & OTPs ──────────────────────────────────────────────

def _otp_rows(account, payload, fetched_at):
    """One row per courier from a fetchDeliveryOTPs answer."""
    rows = []
    for o in (payload or {}).get("supplier_delivery_otp") or [] if isinstance(payload, dict) else []:
        details = [d for d in o.get("otp_details") or [] if isinstance(d, dict)]
        active = next((d for d in details if d.get("active")), details[0] if details else {})
        rows.append({
            "business_id": account.business_id,
            "business_name": account.business.name,
            "courier": (o.get("carrier_details") or {}).get("name") or o.get("carrier_name") or "",
            "courier_icon": (o.get("carrier_details") or {}).get("icon") or "",
            "otp": active.get("otp") or o.get("otp") or "",
            "expires_at": active.get("expiry_timestamp") or o.get("otp_expiry_timestamp"),
            "kind": active.get("display_text") or "OTP",
            "shipments": o.get("count") or (o.get("delivery_shipment_details") or {}).get("total_shipment_count") or 0,
            "awbs": [a for a in o.get("awbs") or [] if a],
            "fetched_at": fetched_at,
        })
    return rows


OTP_PATH = "/api/fulfillment/returnRto/fetchDeliveryOTPs"
OTP_FRESH_SECONDS = 15        # an answer this new is served again, not asked for again (many screens, one call)
OTP_BACKOFF_SECONDS = 120     # a business Meesho refused isn't asked again for this long — polling never piles onto a block


class OtpReadFailed(Exception):
    pass


def _read_otps_from_meesho(account):
    """Ask Meesho for this business's delivery OTPs now, with its saved session
    (as Order Scan's linking does). Returns the answer; raises OtpReadFailed."""
    import json
    import requests
    from . import meesho_sync
    from .meesho_linking import MEESHO_BASE, USER_AGENT, _HTTP
    if account.status != MeeshoAccount.STATUS_ACTIVE or not account.cookies_enc:
        raise OtpReadFailed("not connected — log in under Business Settings")
    try:
        cookies = json.loads(meesho_sync.decrypt(account.cookies_enc))
    except Exception:                                               # noqa: BLE001
        raise OtpReadFailed("its saved session can't be read — log in again under Business Settings")
    headers = {
        "accept": "application/json, text/plain, */*", "accept-language": "en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7",
        "client-package-version": "1.0.4", "client-type": "d-web",
        "content-type": "application/json", "identifier": account.supplier_identifier, "origin": MEESHO_BASE,
        "user-agent": USER_AGENT, "cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()),
        "referer": f"{MEESHO_BASE}/panel/v3/new/fulfillment/{account.supplier_identifier}/returns/overview",
    }
    if account.browser_id:
        headers["browser-id"] = account.browser_id
    body = {"supplier_id": int(account.supplier_id or 0), "identifier": account.supplier_identifier,
            "child_supplier_identifier": None, "child_supplier_id": None}
    try:
        res = _HTTP.post(MEESHO_BASE + OTP_PATH, json=body, headers=headers, timeout=(4, 10))
    except requests.RequestException as exc:
        raise OtpReadFailed(f"Meesho couldn't be reached ({exc.__class__.__name__})")
    if res.status_code in (401, 403, 463):
        blocked = "<html" in res.text[:500].lower()
        raise OtpReadFailed("Meesho's bot protection refused the call" if blocked else "the Meesho session has expired — log in again under Business Settings")
    try:
        answer = res.json()
    except ValueError:
        answer = None
    if res.status_code >= 400 or not isinstance(answer, dict):
        raise OtpReadFailed(f"Meesho answered HTTP {res.status_code}")
    return answer


@api_view(["GET"])
def otps_live(request, business_id):
    """
    Every courier's delivery OTP for every business on this desk, asked of Meesho
    right now (one call per business, side by side) rather than waiting for the
    worker's 10-minute read. Each answer is saved as the business's OTP snapshot,
    so every other screen agrees. An answer under 15 s old is served again — a
    dozen open screens still make one call a business. A business Meesho can't be
    asked for keeps showing its last OTPs, with why.
    """
    from concurrent.futures import ThreadPoolExecutor
    from datetime import timedelta
    from .meesho_sync import _desk_accounts
    business = _views().get_authorized_business(request, business_id)
    _desk, accounts = _desk_accounts(request, business)
    now = timezone.now()
    snaps = {s.account_id: s for s in MeeshoSyncSnapshot.objects.filter(account__in=accounts, endpoint=OTP_SNAPSHOT)}
    stale = [a for a in accounts if not (a.pk in snaps and snaps[a.pk].fetched_at > now - timedelta(seconds=OTP_FRESH_SECONDS))]

    from django.core.cache import cache
    held = {}
    for a in list(stale):
        why = cache.get(f"otp-backoff:{a.pk}")
        if why:
            held[a.pk] = why
            stale.remove(a)

    def ask(account):
        try:
            return account, _read_otps_from_meesho(account), None
        except OtpReadFailed as exc:
            return account, None, str(exc)

    answers = []
    if stale:
        with ThreadPoolExecutor(max_workers=min(8, len(stale))) as pool:
            answers = list(pool.map(ask, stale))
    problems = dict(held)
    for account, answer, problem in answers:
        if problem:
            problems[account.pk] = problem
            cache.set(f"otp-backoff:{account.pk}", f"{problem} · asked again in a moment", OTP_BACKOFF_SECONDS)
            continue
        snaps[account.pk], _ = MeeshoSyncSnapshot.objects.update_or_create(
            account=account, endpoint=OTP_SNAPSHOT, defaults={"payload": answer, "http_status": 200, "fetched_at": timezone.now()})

    otps, businesses = [], []
    for a in sorted(accounts, key=lambda a: a.business.name):
        snap = snaps.get(a.pk)
        rows = _otp_rows(a, snap.payload, snap.fetched_at) if snap else []
        otps += rows
        businesses.append({"business_id": a.business_id, "business_name": a.business.name,
                           "read_at": snap.fetched_at if snap else None, "couriers": len(rows),
                           "live": a.pk not in problems and snap is not None, "problem": problems.get(a.pk)})
    otps.sort(key=lambda x: (x["business_name"], x["courier"]))
    return Response({"otps": otps, "businesses": businesses, "now": timezone.now(), "fresh_seconds": OTP_FRESH_SECONDS})

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
    now = timezone.now()
    otps = []
    fetched = {}
    by_pk = {a.pk: a for a in accounts}
    for snap in MeeshoSyncSnapshot.objects.filter(account__in=accounts, endpoint=OTP_SNAPSHOT):
        fetched[snap.account_id] = snap.fetched_at
        otps += _otp_rows(by_pk[snap.account_id], snap.payload, snap.fetched_at)
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
    rows = list(qs.order_by(*LIST_ORDER[stage])[(page - 1) * LIST_PAGE: page * LIST_PAGE])
    photos = photo_map(rows)
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
        "image_url": photos.get((r.business_id, r.suborder_no), (None, None))[0],
        "image_fallback_url": photos.get((r.business_id, r.suborder_no), (None, None))[1],
    } for r in rows]})
