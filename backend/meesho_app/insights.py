"""
Business Insights: what is selling, what is leaking money, and what changed.

No AI model and no guesswork. Every number here comes from the same profit
engine as the Profit page (views.compute_profit_summary), run twice: once for
the period being looked at, once for the equal-length period just before it.
On top of that sit a few plain statistical tests, chosen so that a SKU with
3 orders and 2 returns doesn't get shouted about the way a SKU with 300
orders and 200 returns should:

  - Rates (return / RTO / claim) are judged by the Wilson lower bound — "even
    giving this SKU the benefit of the doubt, its rate is at least X" — and a
    SKU is only flagged when that floor is above the business's own average.
  - Order-count changes between the two periods are judged as Poisson counts:
    (now - before) / sqrt(now + before), so 60 -> 30 orders is a real drop and
    6 -> 3 is noise.
  - Unusual days use a robust z-score (median and MAD of the previous four
    weeks), so one big sale day doesn't hide the next one.

Rates use SETTLED orders only (delivered / return / RTO / exchange / claim
— the ones Meesho has sent a payment line for). A recent order that hasn't
settled yet is neither good nor bad, so it is left out of the rate instead of
counting as "not returned".
"""

import math
from collections import Counter, defaultdict
from datetime import timedelta

from django.db.models import Count, Max

MAX_DAYS = 92
DEFAULT_DAYS = 30
MIN_SETTLED_FOR_RATE = 10   # below this a rate says more about luck than the SKU
Z_WILSON = 1.96             # one-sided 97.5% — many SKUs are tested at once, so be strict
SEVERITY_ORDER = {"critical": 0, "warning": 1, "opportunity": 2, "good": 3, "info": 4}



# ── small statistics helpers ─────────────────────────────────────────────────

def wilson_lower(k, n, z=Z_WILSON):
    """Lowest rate consistent with k events out of n, at ~97.5% confidence."""
    if n <= 0:
        return 0.0
    p = k / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    spread = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, (centre - spread) / denom)


def count_change_z(now, before):
    """How surprising a move from `before` to `now` orders is, for counts over
    equal-length periods. |z| >= 3 is a change worth acting on."""
    if now + before == 0:
        return 0.0
    return (now - before) / math.sqrt(now + before)


def robust_z(value, history):
    """z-score against the median / MAD of `history` — outliers in the history
    don't drag the baseline around the way a mean would."""
    if len(history) < 7:
        return 0.0, None
    s = sorted(history)
    mid = len(s) // 2
    median = s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2
    mad = sorted(abs(x - median) for x in s)[mid]
    scale = max(1.4826 * mad, 1.0, 0.1 * median)
    return (value - median) / scale, median


def _pct(x):
    return round(x * 100, 1)


def _day_label(iso):
    from datetime import date
    d = date.fromisoformat(iso)
    return f"{d.day} {d:%b}"


def _money(x):
    return round(float(x or 0), 2)


def _rupees(x):
    return f"₹{abs(x):,.0f}"


# ── data gathering ───────────────────────────────────────────────────────────

def _window(business, date_from, date_to):
    """The period to analyse and the one before it. Clipped to the last day
    that has orders, so a period that runs into days not uploaded yet doesn't
    read as every SKU suddenly selling nothing."""
    from .models import Order
    from .views import _parse_day

    data_through = Order.objects.filter(business=business).aggregate(d=Max("order_date"))["d"]
    if not data_through:
        return None
    d_to = _parse_day(date_to) or data_through
    d_from = _parse_day(date_from) or (d_to - timedelta(days=DEFAULT_DAYS - 1))
    if d_to < d_from:
        d_from, d_to = d_to, d_from
    clipped = d_to > data_through
    d_to = min(d_to, data_through)
    if d_from > d_to:
        return None
    capped = (d_to - d_from).days + 1 > MAX_DAYS
    if capped:
        d_from = d_to - timedelta(days=MAX_DAYS - 1)
    days = (d_to - d_from).days + 1
    prev_to = d_from - timedelta(days=1)
    prev_from = prev_to - timedelta(days=days - 1)
    return {
        "date_from": d_from, "date_to": d_to, "prev_from": prev_from, "prev_to": prev_to,
        "days": days, "data_through": data_through, "clipped": clipped, "capped": capped,
    }


def _sku_rows(summary):
    """sku_wise_profit flattened into the numbers the insights need."""
    rows = {}
    for sku, r in (summary.get("sku_wise_profit") or {}).items():
        if sku == "__unattributed__" or "delivered_count" not in r:
            continue
        delivered = r.get("delivered_count", 0) or 0
        returns = r.get("return_count", 0) or 0
        rto = r.get("rto_count", 0) or 0
        exchange = r.get("exchange_count", 0) or 0
        claims = r.get("claim_count", 0) or 0
        settled = delivered + returns + rto + exchange + claims
        net = float(r.get("net_profit") or 0)
        rows[sku] = {
            "sku": sku,
            "parent": r.get("parent_item_id"),
            "orders": r.get("order_count", 0) or 0,
            "settled": settled,
            "delivered": delivered,
            "returns": returns,
            "rto": rto,
            "exchange": exchange,
            "claims": claims,
            "return_rate": _pct(returns / settled) if settled else None,
            "rto_rate": _pct(rto / settled) if settled else None,
            "claim_rate": _pct(claims / settled) if settled else None,
            "net_profit": _money(net),
            "profit_per_order": _money(net / settled) if settled else None,
            "delivered_profit": _money(r.get("delivered_profit")),
            "return_loss": _money(r.get("return_loss")),
            "rto_loss": _money(r.get("rto_loss")),
            "claim_loss": _money(r.get("claim_loss")),
            "claim_settlement": _money(r.get("claim_total_settlement")),
        }
    return rows


class _PricedOrders:
    """The orders sheet for a span of days, minus every order whose item had
    no unit price (missing or ₹0) on its order date — the same rule the
    profit figures use (views._has_unit_price), so order counts, demand
    changes, the daily chart and states all describe the same orders the
    profit does. Loaded once and counted in Python."""

    def __init__(self, business, start, end):
        from .models import Order
        from .views import _has_unit_price, _PriceResolver
        resolver = _PriceResolver(business)
        known = {}

        def priced(sku, day):
            if (sku, day) not in known:
                ok = bool(sku) and sku in resolver.price_map
                known[(sku, day)] = ok and _has_unit_price(resolver.effective_price(sku, day)[2])
            return known[(sku, day)]

        self.rows, self.skipped, seen = [], 0, set()
        for r in (Order.objects.filter(business=business, order_date__range=(start, end))
                  .values("sub_order_no", "sku", "order_date", "customer_state")):
            if r["sub_order_no"] in seen:
                continue
            seen.add(r["sub_order_no"])
            if priced(r["sku"], r["order_date"]):
                self.rows.append(r)
            else:
                self.skipped += 1

    def between(self, d_from, d_to):
        return [r for r in self.rows if d_from <= r["order_date"] <= d_to]


def _orders_by_sku(book, d_from, d_to):
    return Counter(r["sku"] for r in book.between(d_from, d_to))


def _order_total(book, d_from, d_to):
    return len(book.between(d_from, d_to))


def _parent_of(business):
    """SKU -> parent name, from SKU Pricing's links. Sellers often re-list a
    product under a new SKU code; grouping by parent keeps that from looking
    like one product collapsing while another appears from nowhere."""
    from .models import FinalPrice
    return dict(FinalPrice.objects.filter(business=business, parent__isnull=False)
                .values_list("sku_id", "parent__item_id"))


def _product_names(business, skus):
    """The most common product title per SKU — the name sellers recognise."""
    from .models import Order
    names = defaultdict(Counter)
    for sku, name in (Order.objects.filter(business=business, sku__in=list(skus))
                      .exclude(product_name__isnull=True).exclude(product_name="")
                      .values_list("sku", "product_name")):
        names[sku][name] += 1
    return {sku: c.most_common(1)[0][0] for sku, c in names.items()}


def _return_reasons(business, skus, d_from, d_to):
    """Top customer return reasons per SKU, from the returns sheet — when it
    has been uploaded. Empty otherwise."""
    from .models import ReturnDelivery
    reasons = defaultdict(Counter)
    qs = (ReturnDelivery.objects.filter(business=business, sku__in=list(skus),
                                        dispatch_date__range=(d_from, d_to))
          .exclude(return_reason=""))
    for sku, reason in qs.values_list("sku", "return_reason"):
        reasons[sku][reason.strip()] += 1
    return {sku: [{"reason": r, "count": n} for r, n in c.most_common(3)] for sku, c in reasons.items()}


def _daily_orders(book, d_from, d_to):
    start = d_from - timedelta(days=28)
    counts = Counter(r["order_date"] for r in book.between(start, d_to))
    series, day = [], start
    while day <= d_to:
        series.append((day, counts.get(day, 0)))
        day += timedelta(days=1)
    return series


def _state_outcomes(business, book, d_from, d_to):
    """Delivered / RTO / return counts per customer state, for orders placed in
    the period. RTO is the part a seller can act on by state."""
    from .models import OrderPayment
    from .views import _DELIVERED_STATUSES, _RETURN_STATUSES, _RTO_STATUSES
    state_of = {r["sub_order_no"]: r["customer_state"] for r in book.between(d_from, d_to) if r["customer_state"]}
    if not state_of:
        return {}
    outcome = {}
    for sub, status in (OrderPayment.objects.filter(business=business, sub_order_no__in=list(state_of))
                        .exclude(live_order_status__isnull=True)
                        .values_list("sub_order_no", "live_order_status")):
        s = (status or "").upper()
        kind = ("rto" if s in _RTO_STATUSES else "return" if s in _RETURN_STATUSES
                else "delivered" if s in _DELIVERED_STATUSES else None)
        # An order that was RTO'd or returned at any point counts as that.
        if kind and outcome.get(sub) not in ("rto", "return"):
            outcome[sub] = kind
    per_state = defaultdict(Counter)
    for sub, kind in outcome.items():
        per_state[state_of[sub]][kind] += 1
    return per_state


# ── the analysis ─────────────────────────────────────────────────────────────

def _insight(kind, severity, title, why, action, impact=0, sku=None, **extra):
    return {"kind": kind, "severity": severity, "title": title, "why": why,
            "action": action, "impact": round(float(impact or 0), 2), "sku": sku, **extra}


def _kpis(cur, prev, cur_rows, prev_rows, orders_cur, orders_prev):
    def totals(summary, rows, orders):
        settled = sum(r["settled"] for r in rows.values())
        ret = sum(r["returns"] for r in rows.values())
        rto = sum(r["rto"] for r in rows.values())
        claims = sum(r["claims"] for r in rows.values())
        return {
            "orders": orders,
            "net_profit": _money(summary.get("net_profit_loss")),
            "settled": settled,
            "return_rate": _pct(ret / settled) if settled else None,
            "rto_rate": _pct(rto / settled) if settled else None,
            "claim_rate": _pct(claims / settled) if settled else None,
            "profit_per_order": _money(float(summary.get("net_profit_loss") or 0) / settled) if settled else None,
            "active_skus": sum(1 for r in rows.values() if r["orders"]),
        }
    c, p = totals(cur, cur_rows, orders_cur), totals(prev, prev_rows, orders_prev)
    meta = [
        ("orders", "Orders", "up", "count"),
        ("net_profit", "Net profit", "up", "money"),
        ("profit_per_order", "Profit / settled order", "up", "money"),
        ("return_rate", "Return rate", "down", "pct"),
        ("rto_rate", "RTO rate", "down", "pct"),
        ("claim_rate", "Claim rate", "down", "pct"),
        ("active_skus", "SKUs that sold", "up", "count"),
    ]
    out = []
    for key, label, good, fmt in meta:
        a, b = c[key], p[key]
        change = None
        if a is not None and b not in (None, 0):
            change = round((a - b) / abs(b) * 100, 1) if fmt != "pct" else round(a - b, 1)
        out.append({"key": key, "label": label, "current": a, "previous": b,
                    "change": change, "change_unit": "pts" if fmt == "pct" else "%",
                    "good_when": good, "format": fmt})
    return out, c, p


def _rate_outliers(rows, field, count_field, loss_field, baseline, label, names):
    """SKUs whose `field` rate is credibly above the business baseline."""
    flagged = []
    for r in rows.values():
        n, k = r["settled"], r[count_field]
        if n < MIN_SETTLED_FOR_RATE or k < 3 or baseline is None:
            continue
        rate = k / n
        floor = wilson_lower(k, n)
        excess = k - baseline * n
        if floor <= baseline or rate < baseline * 1.4 or excess < 3:
            continue
        per_event_loss = abs(r[loss_field]) / k if k and r.get(loss_field) else 0
        if not per_event_loss and r["delivered"] and r["delivered_profit"] > 0:
            # No direct cost on record (RTO often has none): count the sale
            # that didn't happen instead.
            per_event_loss = r["delivered_profit"] / r["delivered"]
        flagged.append({**r, "product_name": names.get(r["sku"]), "rate": _pct(rate),
                        "baseline": _pct(baseline), "excess": round(excess, 1),
                        "money_at_stake": round(excess * per_event_loss, 2),
                        "severity": "critical" if rate >= 2 * baseline and excess >= 8 else "warning"})
    flagged.sort(key=lambda x: (-x["excess"], -x["rate"]))
    return flagged


def build_insights(business, date_from="", date_to="", request=None):
    from .views import compute_profit_summary

    win = _window(business, date_from, date_to)
    if not win:
        return {"empty": True, "message": "No orders uploaded yet — upload an orders sheet to see insights."}

    cur = compute_profit_summary(business, win["date_from"].isoformat(), win["date_to"].isoformat(), request)
    prev = compute_profit_summary(business, win["prev_from"].isoformat(), win["prev_to"].isoformat(), request)
    cur_rows, prev_rows = _sku_rows(cur), _sku_rows(prev)
    # Orders whose item has a unit price on its order date — the rest are
    # left out of every count here, as they are out of profit.
    book = _PricedOrders(business, min(win["prev_from"], win["date_from"] - timedelta(days=28)), win["date_to"])

    kpis, ct, pt = _kpis(cur, prev, cur_rows, prev_rows,
                         _order_total(book, win["date_from"], win["date_to"]),
                         _order_total(book, win["prev_from"], win["prev_to"]))
    settled_total = ct["settled"]
    base = {
        "return": (ct["return_rate"] or 0) / 100 if settled_total else None,
        "rto": (ct["rto_rate"] or 0) / 100 if settled_total else None,
        "claim": (ct["claim_rate"] or 0) / 100 if settled_total else None,
    }

    orders_now = _orders_by_sku(book, win["date_from"], win["date_to"])
    orders_before = _orders_by_sku(book, win["prev_from"], win["prev_to"])
    all_skus = set(cur_rows) | set(orders_now) | set(orders_before)
    names = _product_names(business, all_skus)
    for rows in (cur_rows, prev_rows):
        for r in rows.values():
            r["product_name"] = names.get(r["sku"])

    total_profit = sum(r["net_profit"] for r in cur_rows.values() if r["net_profit"] > 0) or 1
    highlights = []

    # ── Top performers ──
    top = sorted((r for r in cur_rows.values() if r["settled"] >= 5 and r["net_profit"] > 0),
                 key=lambda r: -r["net_profit"])[:10]
    top_performers = []
    for r in top:
        p = prev_rows.get(r["sku"])
        top_performers.append({**r, "profit_share": _pct(r["net_profit"] / total_profit),
                               "prev_net_profit": p["net_profit"] if p else None,
                               "prev_orders": orders_before.get(r["sku"], 0)})
    if top_performers:
        share = sum(r["profit_share"] for r in top_performers[:5])
        best = top_performers[0]
        highlights.append(_insight(
            "top_performer", "good",
            f"{best['sku']} is your best earner — {_rupees(best['net_profit'])} profit",
            f"Your top 5 SKUs bring in {share:.0f}% of the period's profit. "
            f"{best['sku']} made {_rupees(best['profit_per_order'] or 0)} per settled order "
            f"with a {best['return_rate']}% return rate.",
            "Keep these in stock first, and put ad spend behind them before anything else. "
            "If one SKU carries most of the profit, list close variants of it to spread the risk.",
            impact=best["net_profit"], sku=best["sku"]))

    # ── Return / RTO / claim outliers ──
    high_returns = _rate_outliers(cur_rows, "return_rate", "returns", "return_loss", base["return"], "return", names)
    high_rto = _rate_outliers(cur_rows, "rto_rate", "rto", "rto_loss", base["rto"], "RTO", names)
    high_claims = _rate_outliers(cur_rows, "claim_rate", "claims", "claim_loss", base["claim"], "claim", names)
    if base["claim"] == 0:
        high_claims = []
    reasons = _return_reasons(business, [r["sku"] for r in high_returns[:20]], win["date_from"], win["date_to"])
    for r in high_returns:
        r["top_reasons"] = reasons.get(r["sku"], [])

    for r in high_returns[:5]:
        why_reason = ""
        if r["top_reasons"]:
            why_reason = " Most common reason: \"" + r["top_reasons"][0]["reason"] + "\"."
        highlights.append(_insight(
            "high_returns", r["severity"],
            f"{r['sku']} is returned {r['rate']}% of the time (your average: {r['baseline']}%)",
            f"{r['returns']} returns out of {r['settled']} settled orders — about {r['excess']:.0f} more "
            f"than an average SKU would get." + why_reason,
            "Check the photos, size chart and description against what is actually shipped — customer "
            "returns usually mean the listing promised something the product isn't. Check packing for damage too.",
            impact=r["money_at_stake"] or abs(r["return_loss"]), sku=r["sku"], rate=r["rate"]))
    for r in high_rto[:5]:
        highlights.append(_insight(
            "high_rto", r["severity"],
            f"{r['sku']} has {r['rate']}% RTO (your average: {r['baseline']}%)",
            f"{r['rto']} of {r['settled']} settled orders came back undelivered — about {r['excess']:.0f} "
            "more than usual. RTO is mostly customers refusing at the door, often COD buyers who changed their mind.",
            "Make the listing honest about size and look so impulse buyers don't refuse it, check dispatch is "
            "on time (late parcels get refused), and compare the price with similar listings.",
            impact=r["money_at_stake"], sku=r["sku"], rate=r["rate"]))
    for r in high_claims[:5]:
        highlights.append(_insight(
            "high_claims", r["severity"],
            f"{r['sku']} has {r['claims']} claims ({r['rate']}% vs {r['baseline']}% average)",
            "Claims mean returns came back damaged, used or wrong — this SKU produces them much more than others.",
            "Improve packing for this SKU (stronger box, bubble wrap), record packing videos, and check whether "
            "returns arrive with parts missing.",
            impact=abs(r["claim_loss"]), sku=r["sku"], rate=r["rate"]))

    # ── Loss makers ──
    loss_makers = []
    for r in sorted((r for r in cur_rows.values() if r["net_profit"] < 0 and r["settled"] >= 3),
                    key=lambda r: r["net_profit"])[:15]:
        causes = {"customer returns": abs(r["return_loss"]), "RTO": abs(r["rto_loss"]),
                  "claims": abs(r["claim_loss"])}
        main_cause = max(causes, key=causes.get)
        selling_below_cost = r["delivered"] > 0 and r["delivered_profit"] <= 0
        loss_makers.append({**r, "main_cause": "price below cost" if selling_below_cost else main_cause,
                            "selling_below_cost": selling_below_cost})
    # Small losses stay in the table; only ones worth a seller's time make the list.
    for r in [x for x in loss_makers if x["net_profit"] <= -250][:5]:
        if r["selling_below_cost"]:
            why = (f"Even its delivered orders lose money ({_rupees(r['delivered_profit'])} on "
                   f"{r['delivered']} delivered) — the selling price doesn't cover cost + Meesho fees.")
            action = "Raise the price, or check the cost entered on SKU Pricing is right. Pause ads on it until it's fixed."
        else:
            why = (f"Delivered orders make money, but {r['main_cause']} wipe it out "
                   f"({r['returns']} returns, {r['rto']} RTO out of {r['settled']} settled).")
            action = "Fix what drives the " + r["main_cause"] + " (see the matching card) or raise the price to absorb it."
        highlights.append(_insight("loss_maker", "critical" if r["net_profit"] < -2000 else "warning",
                                   f"{r['sku']} lost {_rupees(r['net_profit'])} this period",
                                   why, action, impact=abs(r["net_profit"]), sku=r["sku"]))

    # ── Demand movers, per product (parent) so re-listed SKU codes don't read as a collapse ──
    parent_of = _parent_of(business)
    group_now, group_before, members = Counter(), Counter(), defaultdict(Counter)
    for counts, bucket in ((orders_now, group_now), (orders_before, group_before)):
        for sku, n in counts.items():
            key = parent_of.get(sku) or sku
            bucket[key] += n
            members[key][sku] += n
    group_profit, group_settled = Counter(), Counter()
    for sku, r in cur_rows.items():
        key = parent_of.get(sku) or sku
        group_profit[key] += r["net_profit"]
        group_settled[key] += r["settled"]
    prev_group_profit, prev_group_settled = Counter(), Counter()
    for sku, r in prev_rows.items():
        key = parent_of.get(sku) or sku
        prev_group_profit[key] += r["net_profit"]
        prev_group_settled[key] += r["settled"]

    rising, falling = [], []
    for key in set(group_now) | set(group_before):
        now, before = group_now.get(key, 0), group_before.get(key, 0)
        z = count_change_z(now, before)
        is_parent = key in members and any(parent_of.get(sk) == key for sk in members[key])
        item = {"sku": key, "is_parent": is_parent,
                "product_name": None if is_parent else names.get(key),
                "skus": [sk for sk, _ in members[key].most_common(5)],
                "orders": now, "prev_orders": before, "change": now - before, "z": round(z, 2),
                "change_pct": round((now - before) / before * 100, 1) if before else None,
                "net_profit": round(group_profit[key], 2) if key in group_settled else None,
                "profit_per_order": round(group_profit[key] / group_settled[key], 2) if group_settled[key] else None,
                "prev_profit_per_order": (round(prev_group_profit[key] / prev_group_settled[key], 2)
                                          if prev_group_settled[key] else None)}
        if z >= 3 and now >= 10:
            rising.append(item)
        elif z <= -3 and before >= 10:
            falling.append(item)
    rising.sort(key=lambda x: -x["z"])
    falling.sort(key=lambda x: x["z"])
    for r in rising[:3]:
        ppo = r["profit_per_order"]
        if ppo is not None and ppo < 0:
            continue
        highlights.append(_insight(
            "rising", "opportunity",
            f"{r['sku']} is taking off — {r['prev_orders']} → {r['orders']} orders",
            "Orders jumped well beyond normal week-to-week noise compared with the previous period.",
            "Make sure stock won't run out, and consider ads or a close variant while demand is high.",
            impact=(r["change"] * (ppo or 0)), sku=r["sku"]))
    for r in falling[:5]:
        highlights.append(_insight(
            "falling", "critical" if r["orders"] == 0 else "warning",
            f"{r['sku']} orders fell {r['prev_orders']} → {r['orders']}",
            "A drop this big is unlikely to be chance. Common causes: listing went out of stock or inactive, "
            "price was undercut, or the listing lost its ranking after bad ratings/returns.",
            "Check the listing is live and in stock on Meesho, compare its price with competitors, and check "
            "recent ratings."
            + ("" if r["is_parent"] else " If you re-listed it under a new SKU code, link both SKUs to one parent "
               "in SKU Pricing → SKU Link so they are tracked as one product."),
            impact=abs(r["change"]) * max(r["prev_profit_per_order"] or 0, 0),
            sku=r["sku"]))

    # ── Return rate worsening vs last period (only when both periods are mostly settled) ──
    worsening = []
    settled_share_now = settled_total / ct["orders"] if ct["orders"] else 0
    settled_share_before = pt["settled"] / pt["orders"] if pt["orders"] else 0
    if settled_share_now >= 0.7 and settled_share_before >= 0.7:
        for sku, r in cur_rows.items():
            p = prev_rows.get(sku)
            if not p or r["settled"] < 15 or p["settled"] < 15:
                continue
            p1, p2 = r["returns"] / r["settled"], p["returns"] / p["settled"]
            pooled = (r["returns"] + p["returns"]) / (r["settled"] + p["settled"])
            se = math.sqrt(pooled * (1 - pooled) * (1 / r["settled"] + 1 / p["settled"])) or 1
            z = (p1 - p2) / se
            if z >= 2.5 and p1 - p2 >= 0.08:
                worsening.append({**r, "prev_return_rate": p["return_rate"], "z": round(z, 2)})
        worsening.sort(key=lambda x: -x["z"])
        for r in worsening[:3]:
            highlights.append(_insight(
                "return_spike", "warning",
                f"{r['sku']} returns jumped {r['prev_return_rate']}% → {r['return_rate']}%",
                "Same SKU, much worse returns than last period — something changed: a new batch from the "
                "supplier, a listing edit, or a packing change.",
                "Open a few recent returns and compare with older stock; check the latest supplier batch.",
                impact=abs(r["return_loss"]), sku=r["sku"]))

    # ── Hidden gems: good margin, low returns, still small ──
    ppo_values = sorted(r["profit_per_order"] for r in cur_rows.values()
                        if r["profit_per_order"] is not None and r["settled"] >= 5)
    hidden_gems = []
    if len(ppo_values) >= 8 and base["return"] is not None:
        q75 = ppo_values[int(len(ppo_values) * 0.75)]
        top_skus = {r["sku"] for r in top_performers}
        for r in cur_rows.values():
            if (r["sku"] not in top_skus and 5 <= r["settled"] <= 40 and r["profit_per_order"] is not None
                    and r["profit_per_order"] >= q75 and r["profit_per_order"] > 0
                    and (r["return_rate"] or 0) + (r["rto_rate"] or 0) <= (base["return"] + base["rto"]) * 100):
                hidden_gems.append(r)
        hidden_gems.sort(key=lambda r: -r["profit_per_order"])
        hidden_gems = hidden_gems[:10]
        if hidden_gems:
            g = hidden_gems[0]
            highlights.append(_insight(
                "hidden_gem", "opportunity",
                f"{g['sku']} earns {_rupees(g['profit_per_order'])} per order but only sold {g['orders']}",
                "High profit per order and fewer returns than average — it just isn't getting seen much. "
                f"{len(hidden_gems)} SKU(s) look like this.",
                "Try a small ad budget on these, or list them in more categories/variants — they are cheaper "
                "growth than pushing a SKU that gets returned.",
                impact=g["profit_per_order"] * g["orders"], sku=g["sku"]))

    # ── Unusual days ──
    series = _daily_orders(book, win["date_from"], win["date_to"])
    daily, anomalies = [], []
    for i, (day, n) in enumerate(series):
        if day < win["date_from"]:
            continue
        history = [x for _, x in series[max(0, i - 28):i]]
        z, expected = robust_z(n, history)
        flag = None
        if expected is not None and expected >= 5:
            if z <= -3.5:
                flag = "low"
            elif z >= 3.5:
                flag = "high"
        daily.append({"date": day.isoformat(), "orders": n,
                      "expected": round(expected, 1) if expected is not None else None,
                      "z": round(z, 2), "anomaly": flag})
        if flag:
            anomalies.append(daily[-1])
    for a in sorted(anomalies, key=lambda a: -abs(a["z"]))[:3]:
        low = a["anomaly"] == "low"
        highlights.append(_insight(
            "daily_anomaly", "warning" if low else "good",
            f"{'Unusually few' if low else 'Unusually many'} orders on {_day_label(a['date'])}: {a['orders']} "
            f"(normal ≈ {a['expected']:.0f})",
            "Far outside the usual day-to-day range of the four weeks before it."
            + (" If you didn't pause anything, check whether that day's orders sheet was fully uploaded."
               if low else ""),
            "Check listings weren't inactive or out of stock that day, and that the upload is complete."
            if low else "Find which SKUs drove it — a sale, an ad or a trending item — and repeat what worked.",
            impact=0))

    # ── States with high RTO ──
    per_state = _state_outcomes(business, book, win["date_from"], win["date_to"])
    states = []
    total_known = sum(sum(c.values()) for c in per_state.values())
    total_rto = sum(c["rto"] for c in per_state.values())
    state_base = total_rto / total_known if total_known else None
    for state, c in per_state.items():
        n = sum(c.values())
        rate = c["rto"] / n if n else 0
        states.append({"state": state, "orders": n, "rto": c["rto"], "returns": c["return"],
                       "delivered": c["delivered"], "rto_rate": _pct(rate),
                       "return_rate": _pct(c["return"] / n) if n else None,
                       "flag": bool(state_base and n >= 30 and c["rto"] >= 5
                                    and wilson_lower(c["rto"], n) > state_base and rate >= state_base * 1.3)})
    states.sort(key=lambda s: -s["orders"])
    bad_states = sorted((s for s in states if s["flag"]), key=lambda s: -s["rto_rate"])
    if bad_states:
        highlights.append(_insight(
            "state_rto", "info",
            f"RTO is highest in {', '.join(s['state'] for s in bad_states[:3])}",
            f"{bad_states[0]['state']} returns {bad_states[0]['rto_rate']}% of orders undelivered vs "
            f"{_pct(state_base)}% overall.",
            "Keep this in mind for ad targeting, and for heavy/fragile SKUs whose RTO costs the most.",
            impact=0))

    # ── Claims: rejected ones are product cost the profit figure never charged ──
    from .insights_money import claims_analysis, payment_checks, payment_window
    claims = claims_analysis(business, win)
    if claims["uploaded"]:
        cp, cprev = claims["period"], claims["previous"]
        true_now = round(ct["net_profit"] - cp["rejected_loss"], 2)
        true_before = round(pt["net_profit"] - cprev["rejected_loss"], 2)
        kpis.insert(2, {"key": "true_profit", "label": "True profit (after rejected claims)",
                        "current": true_now, "previous": true_before,
                        "change": round((true_now - true_before) / abs(true_before) * 100, 1) if true_before else None,
                        "change_unit": "%", "good_when": "up", "format": "money"})
        claims["true_profit"] = {"net_profit": ct["net_profit"], "rejected_loss": cp["rejected_loss"],
                                 "true_profit": true_now}
        if cp["rejected_loss"] > 0:
            share = cp["rejected_loss"] / ct["net_profit"] * 100 if ct["net_profit"] > 0 else None
            highlights.append(_insight(
                "claims_rejected", "critical" if (share or 100) >= 10 else "warning",
                f"Rejected claims cost you {_rupees(cp['rejected_loss'])} — true profit is {_rupees(true_now)}"
                + (" (a loss)" if true_now < 0 else ""),
                f"{cp['rejected']} claim(s) on this period's orders were rejected, so those products were lost "
                f"without compensation. The profit figure assumes returned items can be resold, so this loss is "
                f"not in it" + (f" — it takes away {share:.0f}% of the period's profit." if share else "."),
                "Look at which issues get rejected most (Claims section below) and fix the evidence: unboxing/"
                "packing videos, clear photos, and raising within the deadline.",
                impact=cp["rejected_loss"]))
        if claims["reopenable"]:
            first = claims["reopenable"][0]
            highlights.append(_insight(
                "claims_reopen", "critical",
                f"{len(claims['reopenable'])} rejected claim(s) can still be reopened — worth {_rupees(claims['reopenable_value'])}",
                f"The earliest reopen window closes on {_day_label(first['reopen_by'])}. After that the money is gone for good.",
                "Reopen these on the Meesho supplier panel with better proof (video, photos of the item received).",
                impact=claims["reopenable_value"]))
        worst = [i for i in claims["by_issue"] if (i["approved"] + i["rejected"]) >= 5 and (i["rejection_rate"] or 0) >= 50]
        if worst:
            w = worst[0]
            highlights.append(_insight(
                "claims_issue", "warning",
                f"Claims for \"{w['issue']}\" are rejected {w['rejection_rate']}% of the time",
                f"{w['rejected']} of {w['approved'] + w['rejected']} decided claims of this type were refused, "
                f"costing {_rupees(w['rejected_loss'])}.",
                "Meesho usually rejects these for weak proof. Record an unboxing video for every return of this "
                "kind and attach it when you raise the claim.",
                impact=w["rejected_loss"]))
        if cp["open"] and cp.get("open_expected_loss"):
            highlights.append(_insight(
                "claims_open", "info",
                f"{cp['open']} claim(s) still open — about {_rupees(cp['open_expected_loss'])} may be lost",
                f"Products worth {_rupees(cp['open_at_risk'])} are waiting on a decision; at your past rejection "
                f"rate ({claims['all_time']['rejection_rate']}%) that much is likely to be refused.",
                "Add any extra proof to these tickets now, before Meesho decides.",
                impact=cp["open_expected_loss"]))
    else:
        highlights.append(_insight(
            "claims_missing", "info", "Upload your claims sheet to see rejected-claim losses",
            "Without it, a return whose claim Meesho rejected looks like a normal return — the lost product "
            "never shows up as a cost, so profit looks better than it is.",
            "Use \"Upload claims sheet\" at the top of this page (the same Meesho ticket export as Claim Sheet)."))

    # ── Payments: anything unusual Meesho did with the money ──
    pwin = payment_window(business, date_from, date_to)
    payments = payment_checks(business, pwin) if pwin else None
    if payments:
        for c in payments["checks"]:
            if c["severity"] == "info":
                continue
            highlights.append(_insight(
                f"payment_{c['key']}", c["severity"], c["title"], c["detail"], c["action"],
                impact=abs(c["amount"])))

    highlights.sort(key=lambda h: (SEVERITY_ORDER.get(h["severity"], 9), -abs(h["impact"])))

    return {
        "empty": False,
        "period": {
            "date_from": win["date_from"].isoformat(), "date_to": win["date_to"].isoformat(),
            "prev_from": win["prev_from"].isoformat(), "prev_to": win["prev_to"].isoformat(),
            "days": win["days"], "data_through": win["data_through"].isoformat(),
            "clipped": win["clipped"], "capped": win["capped"],
        },
        "settled_share": {"current": _pct(settled_share_now), "previous": _pct(settled_share_before)},
        # Orders left out because their item has no unit price (missing or ₹0).
        "excluded_no_unit_price": {
            "orders": (cur.get("excluded_no_unit_price") or {}).get("orders", 0),
            "skus": (cur.get("excluded_no_unit_price") or {}).get("zero_price_skus", []),
            "missing_skus": [x for x in cur.get("missing_sku", []) if x][:50],
        },
        "baseline": {k: (_pct(v) if v is not None else None) for k, v in base.items()},
        "kpis": kpis,
        "highlights": highlights,
        "top_performers": top_performers,
        "hidden_gems": hidden_gems,
        "rising": rising[:15],
        "falling": falling[:15],
        "high_returns": high_returns[:20],
        "high_rto": high_rto[:20],
        "high_claims": high_claims[:20],
        "return_spikes": worsening[:10],
        "loss_makers": loss_makers,
        "daily": daily,
        "states": states[:20],
        "claims": claims,
        "payments": payments,
    }


# ── endpoint ─────────────────────────────────────────────────────────────────

from rest_framework.decorators import api_view  # noqa: E402
from rest_framework.response import Response  # noqa: E402


@api_view(["GET"])
def insights_view(request, business_id):
    """GET /api/business/<id>/insights/?date_from=&date_to= — see module docstring."""
    from .permissions import get_authorized_business
    business = get_authorized_business(request, business_id)
    data = build_insights(business, request.GET.get("date_from", ""), request.GET.get("date_to", ""), request)
    from .insights_ai import ai_available, context_hash
    data["ai"] = {"available": ai_available(),
                  "hash": context_hash(data) if ai_available() and not data.get("empty") else None}
    return Response(data)
