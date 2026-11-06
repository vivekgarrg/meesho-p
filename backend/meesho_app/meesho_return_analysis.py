"""
Meesho return analysis — built on the returns Meesho's own API hands us.

The sync worker reads every return from the panel's Returns page (fetchReturnClaims)
and the returns middleware keeps them in the returns table (ReturnDelivery): what
came back, why (Meesho's return reason and its detail), what kind (customer return
or RTO, and the sub-type flag Meesho puts on it), the courier, and where it is.
This module turns those rows into decisions:

  * how many returns in the last 7 / 30 days (and the same length before, to see
    which way it is going) — total, customer returns, RTOs;
  * the return rate — returns raised in the period ÷ orders shipped in it — per
    parent SKU and per SKU, against the business average;
  * which product comes back for which reason, and under which flag;
  * what each return cost — the sale amount reversed, the return shipping charged
    and what was finally settled, read from the payments sheet by sub-order;
  * a ranked list of pointers to stop the loss: where the money is going and
    the one thing to do about it.

Combines every business on the person's desk, like the rest of the Meesho pages.
"""

from collections import defaultdict
from datetime import timedelta

from django.db.models import Q
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import return_guard
from .models import ListingHubPause, Order, OrderPayment, ReturnDelivery, SkuPause

PATH = "meesho-orders/return-analysis/"
WINDOWS = (7, 30, 60, 90)
MIN_RETURNS_FOR_VERDICT = 3          # a rate off one or two returns means nothing
MIN_ORDERS_FOR_RATE = 8


def _views():
    from . import views
    return views


# ── What Meesho calls a return, in words ─────────────────────────────────────

_SUB_TYPE_LABEL = {
    "FIRST_RET": "Customer return",
    "forward_RTO": "RTO — courier could not deliver",
    "EXCHANGE_RTO": "RTO — exchange parcel",
}


def _pretty(s):
    return " ".join(w.capitalize() for w in str(s or "").replace("_", " ").split())


def flag_of(row):
    """(kind, label): the return's flag — customer return vs RTO, and Meesho's sub-type."""
    typ = (row["type_of_return"] or "").lower()
    sub = row["sub_type"] or ""
    kind = "rto" if ("rto" in typ or "rto" in sub.lower()) else "customer"
    if sub in _SUB_TYPE_LABEL:
        return kind, _SUB_TYPE_LABEL[sub]
    if sub:
        return kind, f"{'RTO' if kind == 'rto' else 'Customer return'} — {_pretty(sub)}"
    return kind, "RTO" if kind == "rto" else "Customer return"


def _reason_of(row):
    return (row["return_reason"] or "").strip() or "Not specified"


# ── The request ──────────────────────────────────────────────────────────────

def _parse(request):
    today = timezone.localdate()
    try:
        days = int(request.GET.get("days", 30))
    except (TypeError, ValueError):
        days = 30
    days = days if days in WINDOWS else 30
    start = today - timedelta(days=days - 1)
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=days - 1)
    return today, days, start, prev_start, prev_end


def _pct(n, d):
    return round(100.0 * n / d, 1) if d else None


def _delta(now, before):
    """Change vs the previous period: absolute and percent (None when there was nothing before)."""
    return {"abs": now - before, "pct": round(100.0 * (now - before) / before) if before else None}


@api_view(["GET"])
def return_analysis(request, business_id):
    from .meesho_sync import _desk_accounts
    v = _views()
    business = v.get_authorized_business(request, business_id)
    desk, _accounts = _desk_accounts(request, business, api_path=PATH)
    ids = [b.pk for b in desk]
    names = {b.pk: b.name for b in desk}
    today, days, start, prev_start, prev_end = _parse(request)
    lo = min(prev_start, today - timedelta(days=59))     # also covers the fixed 7- and 30-day views + their priors

    # ── The returns in range ─────────────────────────────────────────────
    rows = list(
        ReturnDelivery.objects.filter(business_id__in=ids)
        .annotate(eff=Coalesce("return_created_date", "delivered_date", "dispatch_date"))
        .filter(eff__gte=lo, eff__lte=today)
        .values("business_id", "suborder_no", "sku", "variation", "product_name", "category", "qty",
                "type_of_return", "sub_type", "return_reason", "detailed_return_reason", "courier_partner",
                "stage", "meesho_status", "claim_status", "claim_amount", "delivered_date", "verify_result",
                "eff", "delivery_attempts", "synced_at")
    )

    # ── SKU → parent ─────────────────────────────────────────────────────
    sku_key = v._sku_key
    resolve = return_guard.sku_resolver(ids)

    for r in rows:
        r["sku_name"], r["parent"] = resolve(r["business_id"], r["sku"], r["variation"])
        r["kind"], r["flag"] = flag_of(r)
        r["reason"] = _reason_of(r)
        r["group"] = v._return_reason_group(r["reason"])
        r["group_label"] = v._RETURN_REASON_GROUP_LABEL.get(r["group"], "Other")
        r["qty"] = r["qty"] or 1

    # ── Orders shipped, for the return rate ───────────────────────────────
    order_rows = list(
        Order.objects.filter(business_id__in=ids, order_date__gte=lo, order_date__lte=today)
        .exclude(reason_for_credit_entry__iexact="CANCELLED")
        .values_list("business_id", "sub_order_no", "sku", "order_date")
    )
    seen = {}
    for biz, so, sku, od in order_rows:
        seen.setdefault((biz, so), (sku, od))
    orders = []                                           # (date, business, sku shown, parent)
    for (biz, _so), (sku, od) in seen.items():
        shown, parent = resolve(biz, sku)
        orders.append((od, biz, shown, parent))

    def in_window(d, a, b):
        return d is not None and a <= d <= b

    def orders_in(a, b, parent=None, sku=None):
        return sum(1 for od, _biz, s, p in orders
                   if in_window(od, a, b) and (parent is None or p == parent) and (sku is None or sku_key(s) == sku_key(sku)))

    def rets(a, b, **where):
        return [r for r in rows if in_window(r["eff"], a, b) and all(r[k] == val for k, val in where.items())]

    d7s, d30s = today - timedelta(days=6), today - timedelta(days=29)
    buckets = _buckets(start, today, days)

    # ── Headline windows: last 7 / last 30 / the one picked ────────────────
    def window(a, b, pa, pb):
        now, before = rets(a, b), rets(pa, pb)
        cust = [r for r in now if r["kind"] == "customer"]
        rto = [r for r in now if r["kind"] == "rto"]
        shipped = orders_in(a, b)
        delivered = max(shipped - len(rto), 0)
        p_cust = sum(1 for r in before if r["kind"] == "customer")
        p_rto = len(before) - p_cust
        p_shipped = orders_in(pa, pb)
        return {
            "from": a.isoformat(), "to": b.isoformat(),
            "returns": len(now), "customer": len(cust), "rto": len(rto),
            "units": sum(r["qty"] for r in now),
            "orders": shipped, "delivered": delivered,
            "rate": _pct(len(now), shipped),
            "customer_rate": _pct(len(cust), delivered), "rto_rate": _pct(len(rto), shipped),
            "previous": len(before), "change": _delta(len(now), len(before)),
            "previous_customer": p_cust, "previous_rto": p_rto, "previous_orders": p_shipped,
            "previous_customer_rate": _pct(p_cust, max(p_shipped - p_rto, 0)), "previous_rto_rate": _pct(p_rto, p_shipped),
            "customer_change": _delta(len(cust), p_cust), "rto_change": _delta(len(rto), p_rto),
        }

    headline = {
        "d7": window(d7s, today, d7s - timedelta(days=7), d7s - timedelta(days=1)),
        "d30": window(d30s, today, d30s - timedelta(days=30), d30s - timedelta(days=1)),
        "picked": window(start, today, prev_start, prev_end),
    }

    cur = rets(start, today)
    prev = rets(prev_start, prev_end)
    total_orders = headline["picked"]["orders"]
    avg_rate = headline["picked"]["rate"] or 0.0
    avg_customer_rate = headline["picked"]["customer_rate"] or 0.0
    avg_rto_rate = headline["picked"]["rto_rate"] or 0.0

    # ── What each return cost: the payments sheet, by sub-order ──────────────
    cost = {}
    wanted = defaultdict(set)
    for r in cur:
        wanted[r["business_id"]].add(r["suborder_no"])
    for biz, subs in wanted.items():
        subs = sorted(subs)
        for i in range(0, len(subs), 500):
            for pr in (OrderPayment.objects.filter(business_id=biz, sub_order_no__in=subs[i:i + 500])
                       .values("sub_order_no", "final_settlement_amount", "total_sale_return_amount",
                               "return_shipping_charge", "claims")):
                c = cost.setdefault((biz, pr["sub_order_no"]), {"settled": 0.0, "refunded": 0.0, "shipping": 0.0, "claims": 0.0})
                c["settled"] += float(pr["final_settlement_amount"] or 0)
                c["refunded"] += float(pr["total_sale_return_amount"] or 0)
                c["shipping"] += float(pr["return_shipping_charge"] or 0)
                c["claims"] += float(pr["claims"] or 0)
    for r in cur:
        c = cost.get((r["business_id"], r["suborder_no"]))
        r["has_cost"] = c is not None
        # Money out of pocket: what settled for the order, flipped — a negative
        # settlement is a loss, and a claim paid back brings it down.
        r["loss"] = round(-c["settled"], 2) if c else 0.0
        r["refunded"] = round(abs(c["refunded"]), 2) if c else 0.0
        r["shipping"] = round(abs(c["shipping"]), 2) if c else 0.0
        r["claims_paid"] = round(c["claims"], 2) if c else 0.0

    def money(group):
        return {
            "loss": round(sum(r["loss"] for r in group), 2),
            "refunded": round(sum(r["refunded"] for r in group), 2),
            "shipping": round(sum(r["shipping"] for r in group), 2),
            "claims": round(sum(r["claims_paid"] for r in group), 2),
            "with_payment": sum(1 for r in group if r["has_cost"]),
        }

    # ── Breakdowns ───────────────────────────────────────────────────────
    def tally(group, keyfn):
        out = defaultdict(lambda: {"count": 0, "units": 0})
        for r in group:
            o = out[keyfn(r)]
            o["count"] += 1
            o["units"] += r["qty"]
        return out

    by_flag = [{"flag": k, "count": o["count"], "share": _pct(o["count"], len(cur)),
                "previous": sum(1 for r in prev if r["flag"] == k)}
               for k, o in sorted(tally(cur, lambda r: r["flag"]).items(), key=lambda kv: -kv[1]["count"])]
    by_reason = [{"reason": k, "count": o["count"], "share": _pct(o["count"], len(cur)),
                  "group": v._return_reason_group(k), "group_label": v._RETURN_REASON_GROUP_LABEL.get(v._return_reason_group(k), "Other")}
                 for k, o in sorted(tally([r for r in cur if r["kind"] == "customer"], lambda r: r["reason"]).items(),
                                    key=lambda kv: -kv[1]["count"])][:12]
    by_group = [{"group": k, "label": v._RETURN_REASON_GROUP_LABEL.get(k, "Other"), "count": o["count"],
                 "share": _pct(o["count"], sum(1 for r in cur if r["kind"] == "customer"))}
                for k, o in sorted(tally([r for r in cur if r["kind"] == "customer"], lambda r: r["group"]).items(),
                                   key=lambda kv: -kv[1]["count"])]

    by_courier = []
    for k, o in sorted(tally([r for r in cur if r["kind"] == "rto"], lambda r: r["courier_partner"] or "Not given").items(),
                       key=lambda kv: -kv[1]["count"]):
        all_for_courier = sum(1 for r in cur if (r["courier_partner"] or "Not given") == k)
        by_courier.append({"courier": k, "rto": o["count"], "all": all_for_courier})

    def entity(group_cur, group_prev, ord_now, ord_prev, key, label, parent=None):
        """One parent / SKU row: counts, rate vs the average, reasons, flags, money, trend."""
        n = len(group_cur)
        cust = [r for r in group_cur if r["kind"] == "customer"]
        reasons = tally(cust, lambda r: r["reason"])
        top = sorted(reasons.items(), key=lambda kv: -kv[1]["count"])[:3]
        groups = tally(cust, lambda r: r["group"])
        top_group = max(groups.items(), key=lambda kv: kv[1]["count"])[0] if groups else None
        rate = _pct(n, ord_now)
        prev_rate = _pct(len(group_prev), ord_prev)
        n_rto = n - len(cust)
        p_cust = sum(1 for r in group_prev if r["kind"] == "customer")
        p_rto = len(group_prev) - p_cust
        delivered = max(ord_now - n_rto, 0)
        p_delivered = max(ord_prev - p_rto, 0)
        couriers = sorted(tally([r for r in group_cur if r["kind"] == "rto"], lambda r: r["courier_partner"] or "Not given").items(),
                          key=lambda kv: -kv[1]["count"])[:3]
        m = money(group_cur)
        e = {
            "key": key, "label": label, "parent": parent,
            "returns": n, "customer": len(cust), "rto": n - len(cust), "units": sum(r["qty"] for r in group_cur),
            "orders": ord_now, "delivered": delivered, "rate": rate, "prev_rate": prev_rate, "previous": len(group_prev),
            "customer_rate": _pct(len(cust), delivered), "rto_rate": _pct(n_rto, ord_now),
            "prev_customer_rate": _pct(p_cust, p_delivered), "prev_rto_rate": _pct(p_rto, ord_prev),
            "previous_customer": p_cust, "previous_rto": p_rto,
            "vs_avg": round(rate - avg_rate, 1) if rate is not None else None,
            "customer_vs_avg": round(_pct(len(cust), delivered) - avg_customer_rate, 1) if _pct(len(cust), delivered) is not None else None,
            "rto_vs_avg": round(_pct(n_rto, ord_now) - avg_rto_rate, 1) if _pct(n_rto, ord_now) is not None else None,
            "top_couriers": [{"courier": k, "count": o["count"]} for k, o in couriers],
            "d7": sum(1 for r in group_cur if r["eff"] >= d7s), "d30": sum(1 for r in group_cur if r["eff"] >= d30s),
            "d7_customer": sum(1 for r in cust if r["eff"] >= d7s), "d7_rto": sum(1 for r in group_cur if r["kind"] == "rto" and r["eff"] >= d7s),
            "d30_customer": sum(1 for r in cust if r["eff"] >= d30s), "d30_rto": sum(1 for r in group_cur if r["kind"] == "rto" and r["eff"] >= d30s),
            "trend": _trend(group_cur, buckets),
            "top_reasons": [{"reason": k, "count": o["count"], "share": _pct(o["count"], len(cust))} for k, o in top],
            "top_group": top_group, "top_group_label": v._RETURN_REASON_GROUP_LABEL.get(top_group, "") if top_group else "",
            "flags": {k: o["count"] for k, o in tally(group_cur, lambda r: r["flag"]).items()},
            "money": m,
            "image": next((r.get("image") for r in group_cur if r.get("image")), None),
        }
        e["excess_loss"] = _excess_loss(e, avg_rate)
        e["action"] = _action(e, avg_rate)
        return e

    by_parent_groups = defaultdict(list)
    by_sku_groups = defaultdict(list)
    for r in cur:
        by_parent_groups[r["parent"] or r["sku_name"]].append(r)
        by_sku_groups[(r["parent"] or "", r["sku_name"])].append(r)
    prev_parent = defaultdict(list)
    prev_sku = defaultdict(list)
    for r in prev:
        prev_parent[r["parent"] or r["sku_name"]].append(r)
        prev_sku[(r["parent"] or "", r["sku_name"])].append(r)

    parents = []
    for key, grp in by_parent_groups.items():
        is_parent = any(r["parent"] for r in grp)
        o_now = orders_in(start, today, parent=key) if is_parent else orders_in(start, today, sku=key)
        o_prev = orders_in(prev_start, prev_end, parent=key) if is_parent else orders_in(prev_start, prev_end, sku=key)
        e = entity(grp, prev_parent.get(key, []), o_now, o_prev, key, key)
        e["has_parent"] = is_parent
        e["product_name"] = next((r["product_name"] for r in grp if r["product_name"]), "")
        parents.append(e)
    parents.sort(key=lambda e: (-(e["money"]["loss"] or 0), -e["returns"]))

    skus = []
    for (parent, sku), grp in by_sku_groups.items():
        e = entity(grp, prev_sku.get((parent, sku), []),
                   orders_in(start, today, sku=sku), orders_in(prev_start, prev_end, sku=sku), sku, sku, parent=parent or None)
        e["product_name"] = next((r["product_name"] for r in grp if r["product_name"]), "")
        skus.append(e)
    skus.sort(key=lambda e: (-(e["money"]["loss"] or 0), -e["returns"]))

    # Photos from the returns table itself.
    img = {}
    for biz_row in ReturnDelivery.objects.filter(business_id__in=ids).exclude(meesho_image_url="").values_list("sku", "meesho_image_url")[:3000]:
        img.setdefault(sku_key(biz_row[0]), biz_row[1])
    for e in skus:
        e["image"] = img.get(sku_key(e["key"]))
    sku_image = {sku_key(e["key"]): e["image"] for e in skus}
    for e in parents:
        child = next((s for s in skus if (s["parent"] or s["key"]) == e["key"] and s["image"]), None)
        e["image"] = child["image"] if child else sku_image.get(sku_key(e["key"]))

    # ── Open claims: money still on the table ──────────────────────────────
    open_claims = [r for r in rows if r["kind"] == "customer" and r["stage"] == ReturnDelivery.STAGE_DELIVERED
                   and r["claim_status"] in ReturnDelivery.OPEN_CLAIM_STATUSES]
    mismatches = [r for r in cur if r["verify_result"] == ReturnDelivery.VERIFY_MISMATCH]
    summary_money = money(cur)

    trend = []
    for a, b in buckets:
        in_b = rets(a, b)
        n_rto = sum(1 for r in in_b if r["kind"] == "rto")
        shipped = orders_in(a, b)
        trend.append({"from": a.isoformat(), "to": b.isoformat(), "orders": shipped,
                      "customer": len(in_b) - n_rto, "rto": n_rto,
                      "customer_rate": _pct(len(in_b) - n_rto, max(shipped - n_rto, 0)), "rto_rate": _pct(n_rto, shipped)})

    guard = _guard_view(request, desk, ids, today, parents, skus)

    pointers = _pointers(parents, skus, by_courier, by_group, summary_money, headline, open_claims,
                         mismatches, len(cur), avg_rate, total_orders, days)

    return Response({
        "days": days, "windows": list(WINDOWS),
        "from": start.isoformat(), "to": today.isoformat(),
        "previous_from": prev_start.isoformat(), "previous_to": prev_end.isoformat(),
        "businesses": [{"id": b.pk, "name": names[b.pk]} for b in desk],
        "headline": headline,
        "average_rate": avg_rate,
        "money": summary_money,
        "by_flag": by_flag, "by_reason": by_reason, "by_group": by_group, "by_courier": by_courier,
        "parents": parents[:80], "skus": skus[:200],
        "open_claims": {"count": len(open_claims)},
        "pointers": pointers,
        "trend": trend,
        "guard": guard,
        "average_customer_rate": avg_customer_rate, "average_rto_rate": avg_rto_rate,
        "data": {"returns_in_range": len(rows), "synced": sum(1 for r in rows if r["synced_at"]),
                 "with_payment": summary_money["with_payment"], "of": len(cur)},
    })


def _buckets(start, today, days):
    """The window cut into day (7-day view) or week pieces, for the trend lines."""
    step = 1 if days <= 7 else 7
    out, a = [], start
    while a <= today:
        b = min(a + timedelta(days=step - 1), today)
        out.append((a, b))
        a = b + timedelta(days=1)
    return out


def _trend(group, buckets):
    """Customer returns and RTOs of this product in each piece of the window — a sparkline."""
    return [{"customer": sum(1 for r in group if r["kind"] == "customer" and a <= r["eff"] <= b),
             "rto": sum(1 for r in group if r["kind"] == "rto" and a <= r["eff"] <= b)} for a, b in buckets]


def _guard_view(request, desk, ids, today, parents, skus):
    """What the Return Guard sees: its rules, each product's standing against them, what it has paused, the alerts."""
    v = _views()
    admin = v._is_admin(request.user)
    stats = return_guard.return_stats(ids, today)
    losses = {}
    for b in desk:
        try:
            for parent, l in return_guard.loss_stats(b, today).items():
                losses[(b.pk, parent)] = l
        except Exception:                      # the profit engine failing must not blank this page
            continue
    paused = {(biz, item): auto for biz, item, auto in
              ListingHubPause.objects.filter(business_id__in=ids).values_list("business_id", "parent__item_id", "auto")}
    default_biz = desk[0].pk if desk else None
    # A parent row is for one business in practice; find it by the parent's name across the desk.
    owners = {}
    for (biz, item) in set(stats) | set(losses) | set(paused):
        owners.setdefault(item, []).append(biz)
    for e in parents:
        item = e["label"] if e.get("has_parent") else None
        e["guard"] = None
        if not item:
            continue
        biz = (owners.get(item) or [default_biz])[0]
        st = stats.get((biz, item), {"orders": 0, "returns": 0, "customer": 0, "rto": 0})
        ls = losses.get((biz, item))
        e["guard"] = {
            "level": "parent", "business": biz,
            "orders": st["orders"], "returns": st["returns"],
            "rate": _pct(st["returns"], st["orders"]),
            "returns_breach": return_guard.breaches_returns(st["orders"], st["returns"]),
            "loss_units": ls["units"] if ls else 0, "loss": float(ls["loss"]) if ls else 0.0,
            "loss_breach": bool(ls and return_guard.breaches_loss(ls["units"], ls["loss"])),
            "paused": (biz, item) in paused, "paused_auto": bool(paused.get((biz, item))),
        }
    sku_stats = return_guard.return_stats(ids, today, level="sku")
    sku_losses = {}
    for b in desk:
        try:
            for sk, l in return_guard.loss_stats(b, today, level="sku").items():
                sku_losses[(b.pk, sk)] = l
        except Exception:
            continue
    sku_paused = {(biz, sk): auto for biz, sk, auto in SkuPause.objects.filter(business_id__in=ids).values_list("business_id", "sku__sku_id", "auto")}
    for e in skus:
        e["guard"] = None
        if not e.get("parent"):
            continue
        pg = next((p["guard"] for p in parents if p["label"] == e["parent"] and p.get("guard")), None)
        biz = pg["business"] if pg else default_biz
        st = sku_stats.get((biz, e["key"]), {"orders": 0, "returns": 0})
        ls = sku_losses.get((biz, e["key"]))
        e["guard"] = {
            "level": "sku", "business": biz, "orders": st["orders"], "returns": st["returns"], "rate": _pct(st["returns"], st["orders"]),
            "returns_breach": return_guard.breaches_returns(st["orders"], st["returns"]),
            "loss_units": ls["units"] if ls else 0, "loss": float(ls["loss"]) if ls else 0.0,
            "loss_breach": bool(ls and return_guard.breaches_loss(ls["units"], ls["loss"])),
            "paused": (biz, e["key"]) in sku_paused, "paused_auto": bool(sku_paused.get((biz, e["key"]))),
        }
    alerts = return_guard.alerts_payload(ids)
    return {"rules": return_guard.rules(), "can_pause": admin, "alerts": alerts,
            "unseen": sum(1 for a in alerts if not a["seen"]),
            "paused_count": len(paused),
            "at_risk": sum(1 for e in parents + skus if e.get("guard") and not e["guard"]["paused"]
                           and (e["guard"]["returns_breach"] or e["guard"]["loss_breach"]))}


# ── Decisions ────────────────────────────────────────────────────────────────

def _excess_loss(e, avg_rate):
    """What this product's returns cost above what an average product would — what fixing it saves."""
    if not e["orders"] or e["rate"] is None or e["returns"] < MIN_RETURNS_FOR_VERDICT or not e["money"]["with_payment"]:
        return 0.0
    per_return = e["money"]["loss"] / e["money"]["with_payment"]
    expected = e["orders"] * (avg_rate / 100.0)
    return round(max(0.0, e["returns"] - expected) * per_return, 0)


def _action(e, avg_rate):
    """One verdict and one thing to do, for one parent / SKU."""
    v = _views()
    rate, n = e["rate"], e["returns"]
    if n < MIN_RETURNS_FOR_VERDICT or e["orders"] < MIN_ORDERS_FOR_RATE or rate is None:
        return {"level": "watch", "title": "Too few orders to judge", "text": "Not enough returns or orders in this period for a reliable rate."}
    fix = v._RETURN_REASON_FIX.get(e["top_group"] or "", "")
    reason = e["top_group_label"].lower() or "mixed reasons"
    if e["rto"] >= max(3, n * 0.6):
        return {"level": "high", "title": "Mostly RTOs — parcels not reaching buyers",
                "text": "Check the courier and the pincodes this ships to; consider COD limits or another courier."}
    if rate >= max(avg_rate * 1.5, 25):
        return {"level": "high", "title": f"Returns {rate}% vs {avg_rate}% average — fix or pause",
                "text": f"Main reason: {reason}. " + (fix.capitalize() + "." if fix else "")}
    if rate >= avg_rate * 1.2 and rate >= 15:
        return {"level": "medium", "title": f"Above average ({rate}% vs {avg_rate}%)",
                "text": (f"Main reason: {reason}. " + (fix.capitalize() + "." if fix else "")).strip()}
    if e["prev_rate"] is not None and rate - e["prev_rate"] >= 8:
        return {"level": "medium", "title": f"Rising: {e['prev_rate']}% → {rate}%",
                "text": f"Returns are climbing — look at what changed (supplier batch, price, listing). Main reason: {reason}."}
    return {"level": "ok", "title": "Within the normal range", "text": ""}


def _pointers(parents, skus, by_courier, by_group, money, headline, open_claims, mismatches, n_returns,
              avg_rate, total_orders, days):
    """A ranked list of what to do to stop the loss, each with the rupees behind it."""
    v = _views()
    out = []

    # 1. Products returning far above average — the saving is the excess loss.
    for e in sorted(parents, key=lambda x: -x["excess_loss"]):
        if e["excess_loss"] > 0 and e["action"]["level"] in ("high", "medium"):
            fix = v._RETURN_REASON_FIX.get(e["top_group"] or "", "")
            out.append({
                "severity": "high" if e["action"]["level"] == "high" else "medium", "kind": "product", "target": e["label"],
                "title": f"{e['label']}: {e['rate']}% of orders come back (average {avg_rate}%)",
                "detail": f"{e['returns']} returns in {days} days"
                          + (f", mostly “{e['top_reasons'][0]['reason']}” ({e['top_reasons'][0]['share']}%)" if e["top_reasons"] else "") + ".",
                "action": (fix.capitalize() if fix else "Review the listing and the supplier batch") + ".",
                "amount": e["excess_loss"], "amount_label": "extra loss vs an average product",
            })
    # 2. One dominant reason across the business.
    if by_group:
        top = by_group[0]
        if top["group"] not in ("unspecified", "other", "changed_mind") and (top["share"] or 0) >= 30 and top["count"] >= 5:
            fix = v._RETURN_REASON_FIX.get(top["group"], "")
            out.append({"severity": "medium", "kind": "reason", "target": top["label"],
                        "title": f"{top['share']}% of customer returns are “{top['label']}”",
                        "detail": f"{top['count']} of your customer returns in {days} days.",
                        "action": (fix.capitalize() if fix else "Look at the products behind it") + ".",
                        "amount": None, "amount_label": ""})
    # 3. A courier whose parcels keep coming back.
    for c in by_courier:
        if c["rto"] >= 5 and c["all"] and c["rto"] / c["all"] >= 0.7 and len(by_courier) > 1:
            out.append({"severity": "medium", "kind": "courier", "target": c["courier"],
                        "title": f"{c['courier']} accounts for {c['rto']} RTOs",
                        "detail": f"{c['rto']} of its {c['all']} returns are parcels that never reached the buyer.",
                        "action": "Compare its delivery rate and pincode coverage with other couriers; raise it with Meesho support.",
                        "amount": None, "amount_label": ""})
            break
    # 4. Claims not yet raised — money Meesho owes if claimed in time.
    if open_claims:
        soon = [r for r in open_claims if r["delivered_date"] and (r["delivered_date"] + timedelta(days=ReturnDelivery.CLAIM_WINDOW_DAYS) - timezone.localdate()).days <= 2]
        out.append({"severity": "high" if soon else "medium", "kind": "claims", "target": "claims",
                    "title": f"{len(open_claims)} delivered return{'s' if len(open_claims) != 1 else ''} with no claim raised",
                    "detail": (f"{len(soon)} expire within 2 days. " if soon else "") + "Meesho only accepts a claim within 7 days of delivery.",
                    "action": "Open Returns & Claims and raise the damaged / wrong-item ones before the window closes.",
                    "amount": None, "amount_label": ""})
    # 5. A wrong product came back — proof for a claim.
    if mismatches:
        out.append({"severity": "high", "kind": "claims", "target": "mismatch",
                    "title": f"{len(mismatches)} returned parcel{'s' if len(mismatches) != 1 else ''} held the wrong product",
                    "detail": "Checked at the desk against what was shipped.",
                    "action": "Raise a claim for each — it is the strongest kind (wrong item received).",
                    "amount": None, "amount_label": ""})
    # 6. The overall direction.
    h = headline["picked"]
    if h["previous"] >= 10 and h["change"]["pct"] is not None and h["change"]["pct"] >= 25:
        out.append({"severity": "medium", "kind": "trend", "target": "trend",
                    "title": f"Returns are up {h['change']['pct']}% on the previous {days} days",
                    "detail": f"{h['returns']} now vs {h['previous']} before.",
                    "action": "Start with the products at the top of the table — they usually explain most of the rise.",
                    "amount": None, "amount_label": ""})
    # 7. Where the money actually goes.
    if money["with_payment"] and money["shipping"] > 0 and money["shipping"] >= 0.25 * max(money["loss"], 1):
        out.append({"severity": "low", "kind": "shipping", "target": "shipping",
                    "title": f"Return shipping charges: ₹{money['shipping']:,.0f}",
                    "detail": f"About {round(100 * money['shipping'] / max(money['loss'], 1))}% of what returns cost you.",
                    "action": "Cutting returns saves this too; also check low-value products where shipping exceeds the margin.",
                    "amount": money["shipping"], "amount_label": "return shipping"})
    rank = {"high": 0, "medium": 1, "low": 2}
    out.sort(key=lambda p: (rank[p["severity"]], -(p["amount"] or 0)))
    return out[:10]
