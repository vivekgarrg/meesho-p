"""
Return Guard — stops a product that is bleeding money before it bleeds more.

Run every morning by the sync worker (manage.py return_guard), and by hand from
the Return Analysis page, it looks at the last GUARD_DAYS days of every
business and pauses a parent product (the same pause the Listing Hub has) when

  * RETURNS — more than RETURN_PCT % of the units shipped came back (customer
    returns and RTOs together), with at least MIN_ORDERS units shipped, or
  * LOSS — it sold LOSS_MIN_UNITS or more delivered units and made a loss on
    them, i.e. it is being sold below what it costs.

Each pause leaves an alert (shown on the Return Analysis page until seen) and
goes out on whichever of WhatsApp / Telegram / email is set up. Someone who
resumes a product it paused is left alone for GRACE_DAYS — the guard doesn't
fight a decision a person made.

The same two rules are also checked per SKU, so one bad SKU of a good product is
paused alone. Pausing a parent pauses each of its SKUs too (one SkuPause each),
and a SKU can be paused or resumed by itself.

A pause here is the Listing Hub's: the product (or SKU) disappears for listing
managers. It does not touch the product on Meesho itself.
"""

import logging
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import FinalPrice, ListingHubPause, Order, ParentItemPrice, ReturnDelivery, ReturnGuardAlert, SkuPause

log = logging.getLogger(__name__)

GUARD_DAYS = 30
RETURN_PCT = 40.0            # paused when returns are ABOVE this share of units shipped…
MIN_ORDERS = 50              # …and at least this many units were shipped
LOSS_MIN_UNITS = 20          # sold at a loss in at least this many delivered units
GRACE_DAYS = 14              # after someone resumes a product

PATH = "meesho-orders/return-analysis/"


def _views():
    from . import views
    return views


def rules():
    return {"days": GUARD_DAYS, "return_pct": RETURN_PCT, "min_orders": MIN_ORDERS,
            "loss_min_units": LOSS_MIN_UNITS, "grace_days": GRACE_DAYS}


def sku_resolver(business_ids):
    """resolve(business, sku, variation="") → (SKU as priced, parent item id or "") —
    case-insensitive, with Meesho's glued-on variation taken off."""
    v = _views()
    key = v._sku_key
    fp = {}
    for biz, sku_id, parent_item in (FinalPrice.objects.filter(business_id__in=business_ids)
                                     .values_list("business_id", "sku_id", "parent__item_id")):
        fp[(biz, key(sku_id))] = (sku_id, parent_item or "")

    def resolve(biz, sku, variation=""):
        cleaned = v.meesho_sku(sku or "", variation or "") or (sku or "")
        hit = fp.get((biz, key(cleaned))) or fp.get((biz, key(sku or "")))
        return hit if hit else (cleaned or "—", "")

    return resolve


# ── What the rules look at ───────────────────────────────────────────────────

def return_stats(business_ids, today, days=GUARD_DAYS, level="parent"):
    """{(business, parent item id): {"orders", "returns", "customer", "rto"}} in UNITS, over
    the last `days` days. Only SKUs that have a parent. level="sku" keys by (business, SKU as
    priced) instead."""
    from .meesho_return_analysis import flag_of
    start = today - timedelta(days=days - 1)
    resolve = sku_resolver(business_ids)
    out = {}
    by_sku = level == "sku"

    def slot(biz, key):
        return out.setdefault((biz, key), {"orders": 0, "returns": 0, "customer": 0, "rto": 0})

    seen = {}
    for biz, so, sku, qty in (Order.objects.filter(business_id__in=business_ids, order_date__gte=start, order_date__lte=today)
                              .exclude(reason_for_credit_entry__iexact="CANCELLED")
                              .values_list("business_id", "sub_order_no", "sku", "quantity")):
        seen.setdefault((biz, so), (sku, qty or 1))
    for (biz, _so), (sku, qty) in seen.items():
        shown, parent = resolve(biz, sku)
        if parent:
            slot(biz, shown if by_sku else parent)["orders"] += qty

    rows = (ReturnDelivery.objects.filter(business_id__in=business_ids)
            .annotate(eff=Coalesce("return_created_date", "delivered_date", "dispatch_date"))
            .filter(eff__gte=start, eff__lte=today)
            .values("business_id", "sku", "variation", "qty", "type_of_return", "sub_type"))
    for r in rows:
        shown, parent = resolve(r["business_id"], r["sku"], r["variation"])
        if not parent:
            continue
        kind, _label = flag_of(r)
        qty = r["qty"] or 1
        s = slot(r["business_id"], shown if by_sku else parent)
        s["returns"] += qty
        s[kind] += qty
    return out


def loss_stats(business, today, days=GUARD_DAYS, level="parent"):
    """{parent item id (or SKU, level="sku"): {"units", "loss"}} — delivered units and what they made,
    where that is a loss."""
    v = _views()
    start = today - timedelta(days=days - 1)
    profit = v.compute_profit_summary(business, start.isoformat(), today.isoformat())
    resolve = sku_resolver([business.pk])
    out = {}
    for sku, b in (profit.get("sku_wise_profit") or {}).items():
        shown, parent = resolve(business.pk, sku)
        if not parent:
            continue
        s = out.setdefault(shown if level == "sku" else parent, {"units": 0, "loss": Decimal("0")})
        s["units"] += int(b.get("delivered_quantity") or 0)
        s["loss"] += Decimal(str(b.get("delivered_profit") or 0))
    return {p: {"units": s["units"], "loss": -s["loss"]} for p, s in out.items() if s["loss"] < 0}


def breaches_returns(orders, returns):
    return orders >= MIN_ORDERS and orders > 0 and 100.0 * returns / orders > RETURN_PCT


def breaches_loss(units, loss):
    return units >= LOSS_MIN_UNITS and loss > 0


# ── Pausing ──────────────────────────────────────────────────────────────────

def _notify(lines):
    try:
        from . import notify
        if notify.channels():
            notify.send("Return Guard: products paused", "\n".join(lines))
    except Exception:                      # an alert channel being down must not undo the pause
        log.exception("return guard: sending the alert failed")


def _pause_skus(business, parent_or_sku, message, user, auto):
    """SkuPause rows for the parent's SKUs (or the one SKU), skipping those already paused."""
    skus = FinalPrice.objects.filter(business=business, parent=parent_or_sku) if isinstance(parent_or_sku, ParentItemPrice) \
        else FinalPrice.objects.filter(pk=parent_or_sku.pk)
    for fp in skus.filter(sku_pause__isnull=True):
        SkuPause.objects.create(business=business, sku=fp, note=message[:255], paused_by=user, auto=auto)


def pause(business, parent, kind, message, *, user=None, auto=True, stats=None):
    """Pause the parent — and, one by one, each of its SKUs — and leave an alert.
    Returns the alert, or None if it was paused already."""
    stats = stats or {}
    with transaction.atomic():
        _row, created = ListingHubPause.objects.get_or_create(
            parent=parent, defaults={"business": business, "note": message[:255], "paused_by": user, "auto": auto})
        if not created:
            return None
        _pause_skus(business, parent, message, user, auto)
        return _alert(business, parent, "", kind, message, stats)


def pause_sku(business, fp, kind, message, *, user=None, auto=True, stats=None):
    """Pause one SKU on its own. Returns the alert, or None if it was paused already."""
    with transaction.atomic():
        if SkuPause.objects.filter(sku=fp).exists():
            return None
        SkuPause.objects.create(business=business, sku=fp, note=message[:255], paused_by=user, auto=auto)
        return _alert(business, fp.parent, fp.sku_id, kind, message, stats or {})


def _alert(business, parent, sku, kind, message, stats):
    return ReturnGuardAlert.objects.create(
        business=business, parent=parent, parent_item_id=parent.item_id if parent else "", sku=sku, kind=kind,
        message=message[:500], days=GUARD_DAYS, orders=stats.get("orders", 0), returns=stats.get("returns", 0),
        rate=stats.get("rate"), units_sold=stats.get("units", 0), loss=stats.get("loss", 0) or 0)


def resume(parent):
    """Resume the parent and all its SKUs; the guard then leaves them alone for GRACE_DAYS."""
    ListingHubPause.objects.filter(parent=parent).delete()
    SkuPause.objects.filter(sku__parent=parent).delete()
    ReturnGuardAlert.objects.filter(parent=parent, resumed_at__isnull=True).update(resumed_at=timezone.now(), seen=True)


def resume_sku(fp):
    SkuPause.objects.filter(sku=fp).delete()
    ReturnGuardAlert.objects.filter(parent=fp.parent, sku=fp.sku_id, resumed_at__isnull=True).update(resumed_at=timezone.now(), seen=True)


def _in_grace(business, parent, sku=""):
    since = timezone.now() - timedelta(days=GRACE_DAYS)
    # A SKU is also left alone when its whole parent was resumed.
    return ReturnGuardAlert.objects.filter(business=business, parent=parent, sku__in={"", sku}, resumed_at__gte=since).exists()


def run(business_ids=None, today=None, dry_run=False):
    """Check every business (or those given) and pause what breaks a rule. Returns what it did."""
    from accounts.models import Business
    today = today or timezone.localdate()
    businesses = list(Business.objects.filter(pk__in=business_ids) if business_ids else Business.objects.all())
    ids = [b.pk for b in businesses]
    parents = {(p.business_id, p.item_id): p for p in ParentItemPrice.objects.filter(business_id__in=ids)}
    already = set(ListingHubPause.objects.filter(business_id__in=ids).values_list("business_id", "parent__item_id"))
    done, lines = [], []

    def act(biz, parent_id, kind, message, stats):
        parent = parents.get((biz.pk, parent_id))
        if not parent or (biz.pk, parent_id) in already or _in_grace(biz, parent):
            return
        entry = {"business": biz.name, "parent": parent_id, "kind": kind, "message": message}
        if not dry_run and not pause(biz, parent, kind, message, auto=True, stats=stats):
            return
        already.add((biz.pk, parent_id))              # its SKUs go with it — don't list them again
        done.append(entry)
        lines.append(f"{biz.name}: {message}")

    stats = return_stats(ids, today)
    for (biz_id, parent_id), s in sorted(stats.items(), key=lambda kv: -kv[1]["returns"]):
        if breaches_returns(s["orders"], s["returns"]):
            rate = round(100.0 * s["returns"] / s["orders"], 1)
            biz = next(b for b in businesses if b.pk == biz_id)
            act(biz, parent_id, ReturnGuardAlert.KIND_RETURNS,
                f"{parent_id} paused: {rate}% of its units came back ({s['returns']} of {s['orders']} shipped in {GUARD_DAYS} days; "
                f"{s['customer']} customer returns, {s['rto']} RTO) — limit is {RETURN_PCT:g}%.",
                {**s, "rate": rate})
    for biz in businesses:
        try:
            losses = loss_stats(biz, today)
        except Exception:
            log.exception("return guard: profit check failed for %s", biz)
            continue
        for parent_id, s in sorted(losses.items(), key=lambda kv: -kv[1]["loss"]):
            if breaches_loss(s["units"], s["loss"]):
                act(biz, parent_id, ReturnGuardAlert.KIND_LOSS,
                    f"{parent_id} paused: sold {s['units']} units in {GUARD_DAYS} days at a loss of ₹{s['loss']:,.0f} "
                    f"— it is selling below what it costs (alert at {LOSS_MIN_UNITS}+ units).", s)
    # The same rules, one SKU at a time — a bad SKU of an otherwise fine product is paused alone.
    fps = {(f.business_id, f.sku_id): f for f in FinalPrice.objects.filter(business_id__in=ids, parent__isnull=False).select_related("parent")}
    sku_paused = set(SkuPause.objects.filter(business_id__in=ids).values_list("business_id", "sku__sku_id"))

    def act_sku(biz, sku_id, kind, message, st):
        fp = fps.get((biz.pk, sku_id))
        if not fp or (biz.pk, sku_id) in sku_paused or (biz.pk, fp.parent.item_id) in already or _in_grace(biz, fp.parent, sku_id):
            return
        entry = {"business": biz.name, "parent": fp.parent.item_id, "sku": sku_id, "kind": kind, "message": message}
        if not dry_run:
            if not pause_sku(biz, fp, kind, message, auto=True, stats=st):
                return
            sku_paused.add((biz.pk, sku_id))
        done.append(entry)
        lines.append(f"{biz.name}: {message}")

    sku_stats = return_stats(ids, today, level="sku")
    for (biz_id, sku_id), st in sorted(sku_stats.items(), key=lambda kv: -kv[1]["returns"]):
        if breaches_returns(st["orders"], st["returns"]):
            rate = round(100.0 * st["returns"] / st["orders"], 1)
            biz = next(b for b in businesses if b.pk == biz_id)
            act_sku(biz, sku_id, ReturnGuardAlert.KIND_RETURNS,
                    f"SKU {sku_id} paused: {rate}% of its units came back ({st['returns']} of {st['orders']} shipped in {GUARD_DAYS} days; "
                    f"{st['customer']} customer returns, {st['rto']} RTO) — limit is {RETURN_PCT:g}%.", {**st, "rate": rate})
    for biz in businesses:
        try:
            sku_losses = loss_stats(biz, today, level="sku")
        except Exception:
            continue
        for sku_id, st in sorted(sku_losses.items(), key=lambda kv: -kv[1]["loss"]):
            if breaches_loss(st["units"], st["loss"]):
                act_sku(biz, sku_id, ReturnGuardAlert.KIND_LOSS,
                        f"SKU {sku_id} paused: sold {st['units']} units in {GUARD_DAYS} days at a loss of ₹{st['loss']:,.0f} "
                        f"— it is selling below what it costs (alert at {LOSS_MIN_UNITS}+ units).", st)
    if lines and not dry_run:
        _notify(lines)
    return done


# ── Endpoints ────────────────────────────────────────────────────────────────

def alerts_payload(business_ids, limit=30):
    rows = ReturnGuardAlert.objects.filter(business_id__in=business_ids).select_related("business")[:limit]
    paused = set(ListingHubPause.objects.filter(business_id__in=business_ids).values_list("parent__item_id", "business_id"))
    sku_paused = set(SkuPause.objects.filter(business_id__in=business_ids).values_list("business_id", "sku__sku_id"))
    return [{"id": a.id, "business": a.business.name, "parent": a.parent_item_id, "sku": a.sku, "kind": a.kind, "message": a.message,
             "orders": a.orders, "returns": a.returns, "rate": a.rate, "units": a.units_sold, "loss": float(a.loss),
             "at": a.created_at, "seen": a.seen, "resumed": a.resumed_at is not None,
             "paused_now": ((a.business_id, a.sku) in sku_paused) if a.sku else ((a.parent_item_id, a.business_id) in paused)}
            for a in rows]


def _target(request, business_id):
    v = _views()
    on_screen = v.get_authorized_business(request, business_id)
    try:
        want = int((request.data.get("business") or on_screen.pk))
    except (TypeError, ValueError):
        return None, Response({"error": "Which business?"}, status=status.HTTP_400_BAD_REQUEST)
    biz = next((b for b in v.accessible_businesses(request, include=on_screen) if b.pk == want), None)
    if not biz:
        return None, Response({"error": "That business isn't yours to change."}, status=status.HTTP_403_FORBIDDEN)
    return biz, None


@api_view(["POST"])
def guard_pause(request, business_id):
    """Admins: {business, parent, paused: true|false, note?} — pause a product from the Return Analysis, or resume it."""
    if not _views()._is_admin(request.user):
        return Response({"error": "Only an admin can pause or resume a product."}, status=status.HTTP_403_FORBIDDEN)
    biz, err = _target(request, business_id)
    if err:
        return err
    sku = str(request.data.get("sku") or "").strip()
    paused = bool(request.data.get("paused"))
    note = str(request.data.get("note") or "").strip() or "Paused from Return Analysis"
    if sku:                                                   # one SKU
        fp = FinalPrice.objects.filter(business=biz, sku_id__iexact=sku).select_related("parent").first()
        if not fp:
            return Response({"error": "No such SKU."}, status=status.HTTP_404_NOT_FOUND)
        if paused:
            pause_sku(biz, fp, ReturnGuardAlert.KIND_MANUAL, f"SKU {fp.sku_id} paused by {request.user.get_username()}: {note}",
                      user=request.user, auto=False)
        else:
            resume_sku(fp)
        return Response({"paused": paused, "sku": fp.sku_id})
    parent = ParentItemPrice.objects.filter(business=biz, item_id__iexact=str(request.data.get("parent") or "")).first()
    if not parent:
        return Response({"error": "That SKU has no parent product — link it to one on SKU Pricing first."},
                        status=status.HTTP_404_NOT_FOUND)
    if paused:
        pause(biz, parent, ReturnGuardAlert.KIND_MANUAL, f"{parent.item_id} paused by {request.user.get_username()}: {note}",
              user=request.user, auto=False)
        return Response({"paused": True, "parent": parent.item_id})
    resume(parent)
    return Response({"paused": False, "parent": parent.item_id})


@api_view(["POST"])
def guard_seen(request, business_id):
    """{ids?: [alert ids]} — mark alerts seen (all of the desk's when no ids)."""
    v = _views()
    from .meesho_sync import _desk_accounts
    business = v.get_authorized_business(request, business_id)
    desk, _accounts = _desk_accounts(request, business, api_path=PATH)
    qs = ReturnGuardAlert.objects.filter(business_id__in=[b.pk for b in desk])
    ids = request.data.get("ids")
    if ids:
        qs = qs.filter(id__in=[int(i) for i in ids if str(i).isdigit()])
    return Response({"seen": qs.update(seen=True)})


@api_view(["POST"])
def guard_run(request, business_id):
    """Admins: run the guard now for the businesses on this desk."""
    v = _views()
    if not v._is_admin(request.user):
        return Response({"error": "Only an admin can run the guard."}, status=status.HTTP_403_FORBIDDEN)
    from .meesho_sync import _desk_accounts
    business = v.get_authorized_business(request, business_id)
    desk, _accounts = _desk_accounts(request, business, api_path=PATH)
    done = run([b.pk for b in desk], dry_run=bool(request.data.get("dry_run")))
    return Response({"paused": done, "dry_run": bool(request.data.get("dry_run"))})
