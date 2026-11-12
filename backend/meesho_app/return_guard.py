"""
Return Guard — stops a product that is bleeding money before it bleeds more.

Run every morning by the sync worker (manage.py return_guard), and by hand from
the Return Analysis page, it looks at the last GUARD_DAYS days of every
business and pauses a parent product (the same pause the Listing Hub has) when

  * RETURNS — customers sent back more than RETURN_PCT % of the units that
    were delivered to them, with at least MIN_ORDERS units delivered. Exact, per
    order: of the orders placed in the window, each counts once by how it
    ended — delivered and kept, or returned by the customer. RTOs never reached
    a customer and orders still on the way have no outcome yet: neither counts.
    The window ends SETTLE_DAYS ago, so its returns have had time to come in, or
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
SETTLE_DAYS = 10             # orders this recent may still be returned — the window ends this many days ago
RETURN_PCT = 40.0            # paused when customer returns are ABOVE this share of units delivered to customers…
MIN_ORDERS = 30              # …and at least this many units were delivered to customers
LOSS_MIN_UNITS = 20          # sold at a loss in at least this many delivered units
GRACE_DAYS = 14              # after someone resumes a product

PATH = "meesho-orders/return-analysis/"


def _views():
    from . import views
    return views


def rules():
    return {"days": GUARD_DAYS, "settle_days": SETTLE_DAYS, "return_pct": RETURN_PCT, "min_orders": MIN_ORDERS,
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

def window(today, days=GUARD_DAYS):
    """The orders the returns rule looks at: placed from `days`+SETTLE_DAYS ago up to SETTLE_DAYS ago."""
    stop = today - timedelta(days=SETTLE_DAYS)
    return stop - timedelta(days=days - 1), stop


def _outcomes(business_ids, subs):
    """{(business, sub-order): "customer" | "rto" | "delivered"} — how each order ended, from the
    returns file (customer return vs courier RTO) and the payments report's status."""
    from .meesho_return_analysis import flag_of
    from .models import OrderPayment
    out = {}
    rank = {"delivered": 1, "exchange": 1, "rto": 2, "return": 3}
    by_biz = {}
    for biz, so in subs:
        by_biz.setdefault(biz, []).append(so)
    for biz, sos in by_biz.items():
        for i in range(0, len(sos), 1000):
            part = sos[i:i + 1000]
            best = {}
            for so, st in OrderPayment.objects.filter(business_id=biz, sub_order_no__in=part).values_list("sub_order_no", "live_order_status"):
                r = rank.get((st or "").strip().lower(), 0)
                if r > best.get(so, (0, ""))[0]:
                    best[so] = (r, (st or "").strip().lower())
            for so, (_r, st) in best.items():
                out[(biz, so)] = "customer" if st == "return" else "rto" if st == "rto" else "delivered"
            # The returns file knows a customer return from an RTO even before payments do.
            for r in ReturnDelivery.objects.filter(business_id=biz, suborder_no__in=part).values("suborder_no", "type_of_return", "sub_type"):
                kind, _label = flag_of(r)
                if kind == "customer" or out.get((biz, r["suborder_no"])) != "customer":
                    out[(biz, r["suborder_no"])] = kind
    return out


def cohort(business_ids, today, days=GUARD_DAYS):
    """Every order placed in window(today, days), once each, with how it ended:
    [{"business", "sub_order", "sku" (as priced), "parent" ("" if none), "qty",
      "end": "delivered" | "customer" | "rto" | "open"}]."""
    start, stop = window(today, days)
    resolve = sku_resolver(business_ids)
    seen = {}
    for biz, so, sku, qty, st in (Order.objects.filter(business_id__in=business_ids, order_date__gte=start, order_date__lte=stop)
                                  .exclude(reason_for_credit_entry__iexact="CANCELLED")
                                  .values_list("business_id", "sub_order_no", "sku", "quantity", "reason_for_credit_entry")):
        seen.setdefault((biz, so), (sku, qty or 1, (st or "").strip().upper()))
    ends = _outcomes(business_ids, list(seen))
    out = []
    for (biz, so), (sku, qty, st) in seen.items():
        shown, parent = resolve(biz, sku)
        end = ends.get((biz, so))
        if end is None:                                   # not in payments or returns yet: the orders sheet's own status
            end = "rto" if st.startswith("RTO") else "delivered" if st in ("DELIVERED", "DOOR_STEP_EXCHANGED") else "open"
        out.append({"business": biz, "sub_order": so, "sku": shown, "parent": parent, "qty": qty, "end": end})
    return out


def tally(rows):
    """Counts in UNITS for some orders of cohort():

      delivered  delivered and kept          customer  returned by the customer
      rto        never reached the customer  open      no outcome yet
      orders     delivered to customers = delivered + customer   (what the rate is out of)
      returns    = customer                                       (what came back)"""
    s = {"orders": 0, "returns": 0, "delivered": 0, "customer": 0, "rto": 0, "open": 0}
    for r in rows:
        s[r["end"]] += r["qty"]
    s["orders"] = s["delivered"] + s["customer"]
    s["returns"] = s["customer"]
    return s


def return_stats(business_ids, today, days=GUARD_DAYS, level="parent", rows=None):
    """{(business, parent item id): tally(...)} for the orders of cohort(); only SKUs that have a parent.
    level="sku" keys by (business, SKU as priced) instead."""
    groups = {}
    for r in (rows if rows is not None else cohort(business_ids, today, days)):
        if r["parent"]:
            groups.setdefault((r["business"], r["sku"] if level == "sku" else r["parent"]), []).append(r)
    return {k: tally(v) for k, v in groups.items()}


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


def _span(today):
    a, b = window(today)
    return f"{a:%d %b}–{b:%d %b}"


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
                f"{parent_id} paused: customers returned {rate}% of what they received — {s['returns']} of {s['orders']} units "
                f"delivered (orders of {_span(today)}; RTO not counted) — limit is {RETURN_PCT:g}%.",
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
                    f"SKU {sku_id} paused: customers returned {rate}% of what they received — {st['returns']} of {st['orders']} units "
                    f"delivered (orders of {_span(today)}; RTO not counted) — limit is {RETURN_PCT:g}%.", {**st, "rate": rate})
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
        fp = (FinalPrice.objects.filter(business=biz, sku_id__iexact=sku).select_related("parent").first()
              or FinalPrice.objects.filter(business=biz, sku_id__iexact=_views().meesho_sku(sku, "")).select_related("parent").first())
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


# ── What is paused, and making it active again ───────────────────────────────

def _desk(request, business_id):
    from .meesho_sync import _desk_accounts
    business = _views().get_authorized_business(request, business_id)
    desk, _accounts = _desk_accounts(request, business, api_path=PATH)
    return desk


@api_view(["GET"])
def sku_pauses(request, business_id):
    """
    GET ?businesses=1,2 — which SKUs are paused in these businesses (each the
    caller can open; default the one on screen), on their own or with their
    parent product — for SKU Analysis to show beside each SKU's P&L and offer
    Pause / Resume (POST pause/ with {business, sku, paused}).
    """
    v = _views()
    on_screen = v.get_authorized_business(request, business_id)
    mine = {b.pk: b for b in v.accessible_businesses(request, include=on_screen)}
    want = [int(x) for x in str(request.GET.get("businesses") or on_screen.pk).split(",") if x.strip().isdigit()]
    ids = [i for i in want if i in mine] or [on_screen.pk]
    skus = [{"business": b, "sku": sku, "parent": parent or "", "note": note, "auto": auto, "at": at, "by": by}
            for b, sku, parent, note, auto, at, by in SkuPause.objects.filter(business_id__in=ids).values_list(
                "business_id", "sku__sku_id", "sku__parent__item_id", "note", "auto", "paused_at", "paused_by__username")]
    parents = [{"business": b, "parent": item, "note": note, "auto": auto, "at": at}
               for b, item, note, auto, at in ListingHubPause.objects.filter(business_id__in=ids).values_list(
                   "business_id", "parent__item_id", "note", "auto", "paused_at")]
    return Response({"skus": skus, "parents": parents, "can_pause": v._is_admin(request.user), "businesses": ids})


@api_view(["GET"])
def guard_paused(request, business_id):
    """
    Every product and SKU paused on this desk's businesses — by the guard or by hand — with
    why, when, and where it stands now on the exact returns rule (so a pause made under an
    older, looser count can be seen for what it is).
    """
    desk = _desk(request, business_id)
    ids = [b.pk for b in desk]
    names = {b.pk: b.name for b in desk}
    today = timezone.localdate()
    stats = return_stats(ids, today)
    sku_stats = return_stats(ids, today, level="sku")
    latest = {}
    for a in ReturnGuardAlert.objects.filter(business_id__in=ids).order_by("created_at"):
        latest[(a.business_id, a.parent_item_id, a.sku)] = a

    def standing(st):
        st = st or {"orders": 0, "returns": 0, "delivered": 0, "customer": 0, "rto": 0, "open": 0}
        return {"delivered_to_customers": st["orders"], "kept": st.get("delivered", 0), "customer_returns": st["returns"],
                "rto": st.get("rto", 0), "open": st.get("open", 0),
                "rate": round(100.0 * st["returns"] / st["orders"], 1) if st["orders"] else None,
                "over_limit": breaches_returns(st["orders"], st["returns"])}

    items = []
    parent_paused = set()
    for p in ListingHubPause.objects.filter(business_id__in=ids).select_related("parent", "paused_by"):
        parent_paused.add(p.parent_id)
        a = latest.get((p.business_id, p.parent.item_id, ""))
        items.append({"level": "parent", "business": p.business_id, "business_name": names.get(p.business_id, ""),
                      "parent": p.parent.item_id, "sku": "", "image": p.parent.image_url or "",
                      "skus": FinalPrice.objects.filter(parent=p.parent).count(),
                      "auto": p.auto, "paused_at": p.paused_at, "paused_by": p.paused_by.get_username() if p.paused_by else "",
                      "reason": (a.message if a else "") or p.note, "kind": a.kind if a else "",
                      "now": standing(stats.get((p.business_id, p.parent.item_id)))})
    for sp in SkuPause.objects.filter(business_id__in=ids).select_related("sku__parent", "paused_by"):
        if sp.sku.parent_id in parent_paused:
            continue                                         # paused with its parent — listed there
        parent = sp.sku.parent.item_id if sp.sku.parent else ""
        a = latest.get((sp.business_id, parent, sp.sku.sku_id))
        items.append({"level": "sku", "business": sp.business_id, "business_name": names.get(sp.business_id, ""),
                      "parent": parent, "sku": sp.sku.sku_id, "image": (sp.sku.parent.image_url if sp.sku.parent else "") or "",
                      "skus": 1, "auto": sp.auto, "paused_at": sp.paused_at,
                      "paused_by": sp.paused_by.get_username() if sp.paused_by else "",
                      "reason": (a.message if a else "") or sp.note, "kind": a.kind if a else "",
                      "now": standing(sku_stats.get((sp.business_id, sp.sku.sku_id)))})
    items.sort(key=lambda i: i["paused_at"], reverse=True)
    return Response({"items": items, "rules": rules(), "can_resume": _views()._is_admin(request.user),
                     "window": [d.isoformat() for d in window(today)]})


@api_view(["POST"])
def guard_resume(request, business_id):
    """
    Admins: make paused products / SKUs active again — {items: [{business, parent} | {business, sku}]},
    or {all: true} for everything paused on the desk (or {all: "auto"}: only what the guard paused).
    The guard then leaves each alone for GRACE_DAYS.
    """
    if not _views()._is_admin(request.user):
        return Response({"error": "Only an admin can make a product active again."}, status=status.HTTP_403_FORBIDDEN)
    desk = _desk(request, business_id)
    ids = {b.pk for b in desk}
    every = request.data.get("all")
    done = []
    if every:
        qs = ListingHubPause.objects.filter(business_id__in=ids).select_related("parent")
        sq = SkuPause.objects.filter(business_id__in=ids).select_related("sku")
        if every == "auto":
            qs, sq = qs.filter(auto=True), sq.filter(auto=True)
        for p in list(qs):
            resume(p.parent)
            done.append(p.parent.item_id)
        for sp in list(sq):
            if SkuPause.objects.filter(pk=sp.pk).exists():     # not already resumed with its parent
                resume_sku(sp.sku)
                done.append(sp.sku.sku_id)
        return Response({"resumed": done})
    for it in request.data.get("items") or []:
        try:
            biz = int(it.get("business"))
        except (TypeError, ValueError, AttributeError):
            continue
        if biz not in ids:
            continue
        if it.get("sku"):
            fp = FinalPrice.objects.filter(business_id=biz, sku_id__iexact=str(it["sku"])).first()
            if fp:
                resume_sku(fp)
                done.append(fp.sku_id)
        elif it.get("parent"):
            parent = ParentItemPrice.objects.filter(business_id=biz, item_id__iexact=str(it["parent"])).first()
            if parent:
                resume(parent)
                done.append(parent.item_id)
    return Response({"resumed": done})


# ── The simple page ──────────────────────────────────────────────────────────

WATCH_PCT = 25.0             # shown as "High" from here (no action taken)
FEW = 10                     # fewer delivered than this: too few to judge


def _status(st, paused):
    if paused:
        return "paused"
    if st["orders"] < FEW:
        return "few"
    rate = 100.0 * st["returns"] / st["orders"]
    if breaches_returns(st["orders"], st["returns"]):
        return "over"
    return "high" if rate >= WATCH_PCT else "ok"


@api_view(["GET"])
def simple_view(request, business_id):
    """
    The Return Analysis page, plainly: for orders placed in a window that ended SETTLE_DAYS ago,
    how many reached customers, how many customers sent back, how many were RTO — overall and per
    product (each with its SKUs), each product's status, and whether auto-pause is on.
    ?days=30|60|90
    """
    from .meesho_return_analysis import _reason_of
    from .models import MeeshoAutoSetting
    desk = _desk(request, business_id)
    ids = [b.pk for b in desk]
    names = {b.pk: b.name for b in desk}
    try:
        days = int(request.GET.get("days", GUARD_DAYS))
    except (TypeError, ValueError):
        days = GUARD_DAYS
    days = days if days in (30, 60, 90) else GUARD_DAYS
    today = timezone.localdate()
    rows = cohort(ids, today, days)

    paused_parents = {(b, item): auto for b, item, auto in
                      ListingHubPause.objects.filter(business_id__in=ids).values_list("business_id", "parent__item_id", "auto")}
    # SKUs paused on their own (case-insensitive, as SKUs are matched everywhere), and their parents —
    # so a paused SKU shows under its product even with no orders in the window.
    paused_skus, paused_sku_parent = {}, {}
    for b, sku, parent_item, auto in SkuPause.objects.filter(business_id__in=ids).values_list(
            "business_id", "sku__sku_id", "sku__parent__item_id", "auto"):
        paused_skus[(b, sku.casefold())] = auto
        paused_sku_parent[(b, sku.casefold())] = (parent_item, sku)

    images = {(b, item): img for b, item, img in
              ParentItemPrice.objects.filter(business_id__in=ids).values_list("business_id", "item_id", "image_url")}

    def entry(level, biz, key, parent, group, paused_auto):
        st = tally(group)
        paused = paused_auto is not None
        return {"level": level, "business": biz, "business_name": names.get(biz, ""), "key": key, "parent": parent,
                "image": images.get((biz, parent)) or "", **st,
                "rate": round(100.0 * st["returns"] / st["orders"], 1) if st["orders"] else None,
                "status": _status(st, paused), "paused": paused, "paused_auto": bool(paused_auto)}

    by_parent, loose = {}, {}
    for r in rows:
        if r["parent"]:
            by_parent.setdefault((r["business"], r["parent"]), []).append(r)
        else:
            loose.setdefault((r["business"], r["sku"]), []).append(r)
    for (b, item) in paused_parents:                     # paused, even with no orders in the window
        by_parent.setdefault((b, item), [])
    extra_skus = {}                                      # paused SKUs with no orders in the window
    for (b, key), (item, sku) in paused_sku_parent.items():
        if item:
            by_parent.setdefault((b, item), [])
            extra_skus.setdefault((b, item), {})[key] = sku
    products = []
    for (b, item), group in by_parent.items():
        parent_paused = (b, item) in paused_parents
        e = entry("parent", b, item, item, group, paused_parents.get((b, item)))
        skus = {}
        for r in group:
            skus.setdefault(r["sku"].casefold(), (r["sku"], []))[1].append(r)
        for key, sku in extra_skus.get((b, item), {}).items():
            skus.setdefault(key, (sku, []))
        e["skus"] = sorted((entry("sku", b, sku, item, g, paused_parents[(b, item)] if parent_paused else paused_skus.get((b, key)))
                            for key, (sku, g) in skus.items()), key=lambda x: -(x["rate"] or 0))
        # Paused on their own while the product stays live: the rest of its SKUs keep selling.
        e["paused_skus"] = 0 if parent_paused else sum(1 for x in e["skus"] if x["paused"])
        products.append(e)
    for (b, sku), group in loose.items():                # SKUs with no parent: not on the Listing Hub — link them first
        e = entry("unlinked", b, sku, "", group, paused_skus.get((b, sku.casefold())))
        e["skus"] = []
        e["paused_skus"] = 0
        products.append(e)
    order = {"over": 0, "paused": 1, "high": 2, "ok": 3, "few": 4}
    products.sort(key=lambda e: (order[e["status"]], -(e["rate"] or 0), -e["orders"]))

    # Why customers sent things back — for the customer returns among these orders.
    returned = {(r["business"], r["sub_order"]) for r in rows if r["end"] == "customer"}
    reasons = {}
    subs = {}
    for b, so in returned:
        subs.setdefault(b, []).append(so)
    for b, sos in subs.items():
        for i in range(0, len(sos), 1000):
            for rd in ReturnDelivery.objects.filter(business_id=b, suborder_no__in=sos[i:i + 1000]).values("suborder_no", "return_reason"):
                k = _reason_of(rd)
                reasons[k] = reasons.get(k, 0) + 1

    start, stop = window(today, days)
    total = tally(rows)
    shipped = total["orders"] + total["rto"] + total["open"]
    setting = MeeshoAutoSetting.get()
    return Response({
        "days": days, "from": start, "to": stop, "settle_days": SETTLE_DAYS,
        "businesses": [{"id": b.pk, "name": b.name} for b in desk],
        "totals": {**total, "shipped": shipped,
                   "rate": round(100.0 * total["returns"] / total["orders"], 1) if total["orders"] else None,
                   "rto_rate": round(100.0 * total["rto"] / (shipped - total["open"]), 1) if shipped - total["open"] else None},
        "products": products,
        "reasons": [{"reason": k, "count": n} for k, n in sorted(reasons.items(), key=lambda x: -x[1])[:8]],
        "rules": {**rules(), "watch_pct": WATCH_PCT, "few": FEW},
        "auto_pause": setting.return_guard_auto,
        "can_pause": _views()._is_admin(request.user),
        "can_link": __import__("meesho_app.sku_parents", fromlist=["linkable_ids"]).linkable_ids(request, desk),
    })


@api_view(["POST"])
def guard_auto(request, business_id):
    """Admins: {on: true|false} — let the guard pause products by itself every morning, or not."""
    from .models import MeeshoAutoSetting
    _desk(request, business_id)
    if not _views()._is_admin(request.user):
        return Response({"error": "Only an admin can change auto-pause."}, status=status.HTTP_403_FORBIDDEN)
    setting = MeeshoAutoSetting.get()
    setting.return_guard_auto = bool(request.data.get("on"))
    setting.updated_by = request.user
    setting.save(update_fields=["return_guard_auto", "updated_by"])
    return Response({"auto_pause": setting.return_guard_auto})
