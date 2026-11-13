"""
Two whole-account actions on the Meesho Inventory page (admin only):

Pause the SKUs with no orders
    Every live SKU of a business with no order in the last N days (30 by
    default) — from the orders table, by our SKU (Meesho's with the variation
    taken off), or per catalog when asked. Left alone: SKUs the inventory read
    first saw within those days (too new to have had orders), and every
    business whose order data isn't current (no order in the last
    ORDERS_FRESH_DAYS days — a sync that stopped would make every SKU look
    idle). The page shows the list first; pausing takes it again on the server
    and pauses only what is still idle, through the usual pause job.

Stock to 0, and back (MeeshoStockHold)
    Start: the worker reads every active catalog fresh, saves each live SKU's
    stock, then sets those to 0. Restore: each SKU it set to 0 gets its saved
    stock back — only while still live and still at 0. See MeeshoStockHold.
"""

from collections import defaultdict
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Max
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import (
    MeeshoAccount, MeeshoListing, MeeshoStockHold, MeeshoStockHoldItem, MeeshoSyncRun, Order,
)

DAYS_DEFAULT, DAYS_MIN, DAYS_MAX = 30, 7, 365
ORDERS_FRESH_DAYS = 2           # a business's newest order at most this old, or its order data is taken as stale
PAUSE_LIMIT = 2000              # SKUs one pause sends (the rest: run it again)
HOLD_JOB = "MeeshoStockHoldJob"
HOLD_BUSY_FOR = timedelta(hours=4)    # a hold run still queued/running after this is taken as dead
H = MeeshoStockHold
I = MeeshoStockHoldItem


def _ms():
    from . import meesho_sync
    return meesho_sync


def _admin(request):
    ms = _ms()
    if not ms._views()._is_admin(request.user):
        return Response({"error": "Only an admin can do this on Meesho."}, status=status.HTTP_403_FORBIDDEN)
    return None


def _accounts(request, business_id):
    ms = _ms()
    business = ms._views().get_authorized_business(request, business_id)
    _desk, accounts = ms._inventory_accounts(request, business)
    return accounts


def _wanted(request, accounts):
    """The accounts of the businesses asked for ({"businesses": [ids]} / ?businesses=1,2), or all."""
    raw = request.data.get("businesses") if request.method == "POST" and isinstance(request.data, dict) else request.GET.get("businesses")
    if isinstance(raw, str):
        raw = [x for x in raw.split(",") if x.strip()]
    ids = set()
    for x in raw or []:
        try:
            ids.add(int(x))
        except (TypeError, ValueError):
            pass
    return [a for a in accounts if not ids or a.business_id in ids]


def _busy(account, kinds):
    ms = _ms()
    return account.runs.filter(kind__in=kinds, status__in=[MeeshoSyncRun.STATUS_QUEUED, MeeshoSyncRun.STATUS_RUNNING],
                               queued_at__gte=timezone.now() - ms.STUCK_AFTER).exists()


def _account_problem(a):
    if a.status != MeeshoAccount.STATUS_ACTIVE:
        return "the Meesho account isn't connected — fix it on Meesho Sync."
    if not (a.supplier_id and a.supplier_identifier):
        return "set the supplier ID and code on Meesho Sync first."
    return None


# ── Pause the SKUs with no orders ────────────────────────────────────────────

def _days(raw):
    try:
        return max(DAYS_MIN, min(DAYS_MAX, int(raw or DAYS_DEFAULT)))
    except (TypeError, ValueError):
        return DAYS_DEFAULT


def idle(accounts, days, per_catalog=False, today=None):
    """{account: {"since", "newest_order", "stale", "rows": [listing + last order], "kept_new": n, "kept_ordered": n}}"""
    v = _ms()._views()
    today = today or timezone.localdate()
    since = today - timedelta(days=days)
    new_after = timezone.now() - timedelta(days=days)
    out = {}
    for a in accounts:
        biz = a.business_id
        newest = Order.objects.filter(business_id=biz).aggregate(d=Max("order_date"))["d"]
        stale = newest is None or (today - newest).days > ORDERS_FRESH_DAYS
        recent = Order.objects.filter(business_id=biz, order_date__gte=since).exclude(sku__isnull=True).exclude(sku="")
        by_sku = {s.casefold() for s in recent.values_list("sku", flat=True).distinct()}
        by_cat = {(c, s.casefold()) for c, s in recent.exclude(catalog_id__isnull=True).values_list("catalog_id", "sku").distinct()}
        last = {}
        for s, d in Order.objects.filter(business_id=biz).exclude(sku__isnull=True).values("sku").annotate(d=Max("order_date")).values_list("sku", "d"):
            k = s.casefold()
            last[k] = max(filter(None, [last.get(k), d]), default=None)
        rows, kept_new, kept_ordered = [], 0, 0
        for l in MeeshoListing.objects.filter(account=a, archived=False).select_related("catalog").order_by("sku_id", "catalog__catalog_id"):
            ours = v.meesho_sku(l.sku_id, l.variation)
            k = ours.casefold()
            ordered = (l.catalog.catalog_id, k) in by_cat if per_catalog else k in by_sku
            if ordered:
                kept_ordered += 1
                continue
            if l.first_seen_at and l.first_seen_at > new_after:
                kept_new += 1
                continue
            rows.append({"id": l.pk, "sku": ours, "catalog_id": l.catalog.catalog_id, "catalog_name": l.catalog.name,
                         "variation": l.variation, "inventory": l.inventory, "image": l.image_url,
                         "last_order": last.get(k), "first_seen": l.first_seen_at})
        out[a] = {"since": since, "newest_order": newest, "stale": stale, "rows": rows,
                  "kept_new": kept_new, "kept_ordered": kept_ordered}
    return out


@api_view(["GET"])
def idle_view(request, business_id):
    """GET meesho-live-inventory/idle/?days=30&per_catalog=0 — the live SKUs with no orders in those days, per business."""
    err = _admin(request)
    if err:
        return err
    days, per_catalog = _days(request.GET.get("days")), request.GET.get("per_catalog") in ("1", "true")
    res = idle(_wanted(request, _accounts(request, business_id)), days, per_catalog)
    return Response({"days": days, "per_catalog": per_catalog, "fresh_days": ORDERS_FRESH_DAYS, "businesses": [{
        "business_id": a.business_id, "business_name": a.business.name, "problem": _account_problem(a),
        "since": r["since"], "newest_order": r["newest_order"], "stale": r["stale"],
        "kept_new": r["kept_new"], "kept_ordered": r["kept_ordered"], "count": len(r["rows"]), "rows": r["rows"],
    } for a, r in res.items()]})


@api_view(["POST"])
def idle_pause_view(request, business_id):
    """POST meesho-live-inventory/idle/pause/ {days, per_catalog, listings: [ids]} — pause them, if still idle."""
    err = _admin(request)
    if err:
        return err
    ms = _ms()
    data = request.data if isinstance(request.data, dict) else {}
    days, per_catalog = _days(data.get("days")), bool(data.get("per_catalog"))
    try:
        ids = list(dict.fromkeys(int(x) for x in data.get("listings") or []))
    except (TypeError, ValueError):
        return Response({"error": "Choose the SKUs from the list."}, status=status.HTTP_400_BAD_REQUEST)
    if not ids:
        return Response({"error": "Choose the SKUs from the list first."}, status=status.HTTP_400_BAD_REQUEST)
    if len(ids) > PAUSE_LIMIT:
        return Response({"error": f"At most {PAUSE_LIMIT} SKUs at a time — pause these, then the rest."}, status=status.HTTP_400_BAD_REQUEST)
    accounts = _accounts(request, business_id)
    mine = MeeshoListing.objects.filter(pk__in=ids, account__in=accounts).values_list("account_id", flat=True)
    involved = [a for a in accounts if a.pk in set(mine)]
    if len(mine) != len(ids):
        return Response({"error": "Some of these are no longer listed — check the list again."}, status=status.HTTP_409_CONFLICT)
    res = idle(involved, days, per_catalog)
    plan = {}
    for a, r in res.items():
        name = a.business.name
        if problem := _account_problem(a):
            return Response({"error": f"{name}: {problem}"}, status=status.HTTP_400_BAD_REQUEST)
        if r["stale"]:
            return Response({"error": f"{name}: its newest order is from {r['newest_order'] or 'never'} — the order data isn't current, "
                                      f"so SKUs would look idle that aren't. Let the orders sync catch up first."},
                            status=status.HTTP_409_CONFLICT)
        if _busy(a, [ms.KIND_ARCHIVE]):
            return Response({"error": f"{name}: a pause is already in progress — wait for it to finish."}, status=status.HTTP_409_CONFLICT)
        still = {x["id"] for x in r["rows"]}
        gone = [i for i in ids if i not in still and MeeshoListing.objects.filter(pk=i, account=a).exists()]
        if gone:
            return Response({"error": f"{name}: {len(gone)} of these had an order or were paused since the list was read — check the list again."},
                            status=status.HTTP_409_CONFLICT)
        rows = MeeshoListing.objects.filter(pk__in=[i for i in ids if i in still]).select_related("catalog")
        for l in rows:
            plan.setdefault(a, {}).setdefault(l.catalog.catalog_id, []).append({"product_id": l.product_id, "variation_id": l.variation_id})
    work = {a: ([{"catalog_id": cid, "products": prods} for cid, prods in cats.items()], sum(len(p) for p in cats.values()))
            for a, cats in plan.items()}
    try:
        runs = ms._send(work, ms.KIND_ARCHIVE, ms.ARCHIVE_JOB,
                        lambda n: f"Pausing {n} SKU{'' if n == 1 else 's'} with no orders in {days} days…")
    except ms.SyncNotConfigured as exc:
        return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({"runs": [ms._run_json(r) for r in runs], "skus": sum(n for _g, n in work.values())}, status=status.HTTP_202_ACCEPTED)


# ── Stock to 0, and back ─────────────────────────────────────────────────────

def _run_busy(run):
    return bool(run) and run.status in (MeeshoSyncRun.STATUS_QUEUED, MeeshoSyncRun.STATUS_RUNNING) \
        and run.queued_at >= timezone.now() - HOLD_BUSY_FOR


def hold_json(h):
    counts = dict(h.items.values("state").annotate(n=Count("id")).values_list("state", "n"))
    run = h.restore_run if h.status in (H.STATUS_RESTORING, H.STATUS_RESTORED) and h.restore_run else h.hold_run
    working = _run_busy(run)
    return {
        "id": h.pk, "business_id": h.account.business_id, "business_name": h.account.business.name, "status": h.status,
        "message": h.message, "created_at": h.created_at, "held_at": h.held_at, "restored_at": h.restored_at,
        "created_by": getattr(h.created_by, "username", None), "counts": counts, "working": working,
        "run": _ms()._run_json(run) if run else None,
        "can_restore": h.status in (H.STATUS_HELD, H.STATUS_HOLDING, H.STATUS_RESTORING) and not working
                       and any(counts.get(s) for s in I.TO_RESTORE),
        "items": [{"sku": x.sku_id, "variation": x.variation, "catalog_id": x.catalog_id, "previous": x.previous_inventory,
                   "state": x.state, "message": x.message} for x in h.items.all()[:3000]],
    }


@api_view(["GET"])
def holds_view(request, business_id):
    """GET meesho-live-inventory/stock-hold/ — per business: its open hold (or last one), and what starting one would cover."""
    err = _admin(request)
    if err:
        return err
    out = []
    for a in _accounts(request, business_id):
        last = a.stock_holds.select_related("account__business", "created_by", "hold_run", "restore_run").first()
        live = MeeshoListing.objects.filter(account=a, archived=False)
        out.append({"business_id": a.business_id, "business_name": a.business.name, "problem": _account_problem(a),
                    "live": live.count(), "with_stock": live.filter(inventory__gt=0).count(),
                    "hold": hold_json(last) if last else None,
                    "open": bool(last and last.status in H.OPEN)})
    return Response({"businesses": out})


@api_view(["POST"])
def hold_start_view(request, business_id):
    """POST meesho-live-inventory/stock-hold/start/ {businesses: [ids]} — save every live SKU's stock, then set them to 0."""
    err = _admin(request)
    if err:
        return err
    ms = _ms()
    accounts = _wanted(request, _accounts(request, business_id))
    if not accounts:
        return Response({"error": "Choose the businesses first."}, status=status.HTTP_400_BAD_REQUEST)
    for a in accounts:
        name = a.business.name
        if problem := _account_problem(a):
            return Response({"error": f"{name}: {problem}"}, status=status.HTTP_400_BAD_REQUEST)
        if a.stock_holds.filter(status__in=H.OPEN).exists():
            return Response({"error": f"{name}: its stock is already held at 0 — restore it before holding again "
                                      f"(a second hold would save the zeros)."}, status=status.HTTP_409_CONFLICT)
        if _busy(a, [ms.KIND_STOCK, ms.KIND_ARCHIVE]):
            return Response({"error": f"{name}: a stock update or pause is in progress — wait for it to finish."},
                            status=status.HTTP_409_CONFLICT)
        if not MeeshoListing.objects.filter(account=a, archived=False).exists():
            return Response({"error": f"{name}: no live SKUs in the last inventory read — Refresh it first."},
                            status=status.HTTP_409_CONFLICT)
    holds = []
    for a in accounts:
        with transaction.atomic():
            live = list(MeeshoListing.objects.filter(account=a, archived=False).select_related("catalog"))
            run = MeeshoSyncRun.objects.create(account=a, kind=ms.KIND_STOCK, trigger=MeeshoSyncRun.TRIGGER_MANUAL,
                                               records=len(live), message=f"Stock to 0: saving the stock of {len(live)} live SKUs first…")
            h = H.objects.create(account=a, hold_run=run, created_by=request.user if request.user.is_authenticated else None,
                                 message="Waiting for the worker.")
            # What the app last saw live — the worker reads each catalog fresh and saves what Meesho says now.
            I.objects.bulk_create([I(hold=h, catalog_id=l.catalog.catalog_id, product_id=l.product_id, variation_id=l.variation_id,
                                     sku_id=l.sku_id[:255], variation=l.variation[:255]) for l in live])
        try:
            ms.enqueue(HOLD_JOB, [a.pk, run.pk, h.pk, "hold"], retry=False)
        except Exception as exc:                                # noqa: BLE001 — nothing was sent: the hold is closed again
            H.objects.filter(pk=h.pk).update(status=H.STATUS_FAILED, message=f"Not started — the job queue isn't reachable ({exc}).")
            MeeshoSyncRun.objects.filter(pk=run.pk).update(status=MeeshoSyncRun.STATUS_FAILED, finished_at=timezone.now(),
                                                         message="Could not reach the job queue — nothing was sent to Meesho.")
            return Response({"error": "The job queue (Redis) isn't reachable — nothing was sent to Meesho."},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        holds.append(h)
    return Response({"holds": [hold_json(H.objects.select_related("account__business").get(pk=h.pk)) for h in holds]},
                    status=status.HTTP_202_ACCEPTED)


@api_view(["POST"])
def hold_restore_view(request, business_id, hold_id):
    """POST meesho-live-inventory/stock-hold/<id>/restore/ — give each SKU set to 0 its saved stock back."""
    err = _admin(request)
    if err:
        return err
    ms = _ms()
    accounts = _accounts(request, business_id)
    with transaction.atomic():
        h = H.objects.select_for_update().filter(pk=hold_id, account__in=accounts).select_related("account__business").first()
        if not h:
            return Response({"error": "No such stock hold here."}, status=status.HTTP_404_NOT_FOUND)
        name = h.account.business.name
        if h.status not in (H.STATUS_HELD, H.STATUS_HOLDING, H.STATUS_RESTORING) or _run_busy(h.hold_run) or _run_busy(h.restore_run):
            return Response({"error": f"{name}: this hold can't be restored now ({h.status.lower()}"
                                      f"{', the worker is still on it' if _run_busy(h.hold_run) or _run_busy(h.restore_run) else ''})."},
                            status=status.HTTP_409_CONFLICT)
        if problem := _account_problem(h.account):
            return Response({"error": f"{name}: {problem}"}, status=status.HTTP_400_BAD_REQUEST)
        if _busy(h.account, [ms.KIND_STOCK]):
            return Response({"error": f"{name}: a stock update is in progress — wait for it to finish."}, status=status.HTTP_409_CONFLICT)
        n = h.items.filter(state__in=I.TO_RESTORE).count()
        if not n:
            return Response({"error": f"{name}: nothing of this hold is waiting to be restored."}, status=status.HTTP_409_CONFLICT)
        run = MeeshoSyncRun.objects.create(account=h.account, kind=ms.KIND_STOCK, trigger=MeeshoSyncRun.TRIGGER_MANUAL,
                                           records=n, message=f"Stock back: restoring {n} SKUs to their saved stock…")
        h.status, h.restore_run, h.message = H.STATUS_RESTORING, run, "Waiting for the worker."
        h.save(update_fields=["status", "restore_run", "message", "updated_at"])
    try:
        ms.enqueue(HOLD_JOB, [h.account_id, run.pk, h.pk, "restore"], retry=False)
    except Exception as exc:                                    # noqa: BLE001
        H.objects.filter(pk=h.pk).update(status=H.STATUS_HELD, message=f"Restore not started — the job queue isn't reachable ({exc}).")
        MeeshoSyncRun.objects.filter(pk=run.pk).update(status=MeeshoSyncRun.STATUS_FAILED, finished_at=timezone.now(),
                                                     message="Could not reach the job queue — nothing was sent to Meesho.")
        return Response({"error": "The job queue (Redis) isn't reachable — nothing was sent to Meesho."},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({"hold": hold_json(H.objects.select_related("account__business").get(pk=h.pk))}, status=status.HTTP_202_ACCEPTED)
