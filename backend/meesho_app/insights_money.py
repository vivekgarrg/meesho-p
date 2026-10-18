"""
The money side of Business Insights: claims and payments.

Claims — the profit engine treats a customer return as an item that came back
and can be sold again, so it charges no product cost for it. That is wrong
for a return Meesho's claim desk refused: the item came back damaged, used,
wrong or short, the claim for it was rejected, and the product's cost is simply
gone. Nothing else in the app subtracts that, so here it is: every rejected
ticket from the uploaded claims sheet (the same supplier-panel export Returns
& Claims reads) is costed at the item's price on its ORDER date, and taken off
the period's profit to give the "true profit".

Payments — Meesho's payment sheets change without notice: a SKU's shipping
charge creeps up after a weight re-measure, a return costs ₹300 instead of
₹150, an adjustment type nobody has seen before appears, one sub-order picks
up five rows. Each check below compares the period's payments with what is
normal for the business (or for that SKU), and lists the rows behind every
flag so they can be checked or disputed.
"""

import re
import statistics
from collections import Counter, defaultdict
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Max
from django.utils import timezone

HIGH_RETURN_FEE = Decimal("200")
MAX_ROWS_LISTED = 60
ROUTINE_RECOVERIES = {"affiliate fee", "return assurance program fees"}


def _f(x):
    return round(float(x or 0), 2)


def _qty(row):
    return max(int(row.get("quantity") or 1), 1)


def _per_unit(amount, row):
    """Shipping scales with quantity, so a 3-piece order is compared per piece."""
    return abs(float(amount)) / _qty(row)


def _median(xs):
    return statistics.median(xs) if xs else None


# ── Claims ───────────────────────────────────────────────────────────────────

def _first_sentence(text, limit=180):
    from .helpers.helper import strip_html
    t = re.sub(r"\s+", " ", strip_html(text or "")).strip()
    return t[:limit]


def _norm_issue(issue):
    return (issue or "").strip() or "Not stated"


def claims_analysis(business, win):
    """Every claim ticket, costed, plus period and all-time summaries."""
    from .models import ClaimTicket, Order, OrderPayment
    from .views import _PriceResolver

    tickets = list(ClaimTicket.objects.filter(business=business))
    if not tickets:
        return {"uploaded": False}

    subs = {t.suborder_no for t in tickets if t.suborder_no}
    orders = {o["sub_order_no"]: o for o in Order.objects.filter(business=business, sub_order_no__in=subs)
              .values("sub_order_no", "sku", "order_date", "quantity", "product_name")}
    pay = {}
    for p in (OrderPayment.objects.filter(business=business, sub_order_no__in=subs)
              .exclude(supplier_sku__isnull=True).values("sub_order_no", "supplier_sku", "order_date", "product_name")):
        pay.setdefault(p["sub_order_no"], p)

    resolver = _PriceResolver(business)
    today = timezone.localdate()
    rows = []
    for t in tickets:
        o, p = orders.get(t.suborder_no, {}), pay.get(t.suborder_no, {})
        sku = t.sku or o.get("sku") or p.get("supplier_sku") or ""
        od = o.get("order_date") or (p.get("order_date").date() if p.get("order_date") else None)
        created = timezone.localtime(t.created_at_meesho).date() if t.created_at_meesho else None
        qty = t.qty or o.get("quantity") or 1
        cost = Decimal("0")
        if sku:
            _fp, _pkg, item_price, tax = resolver.effective_price(sku, od or created)
            cost = Decimal(str(item_price or 0)) * qty * (1 + Decimal(str(tax or 0)) / 100)
        rejected = t.ticket_status == ClaimTicket.STATUS_REJECTED
        rows.append({
            "ticket_id": t.ticket_id,
            "suborder_no": t.suborder_no,
            "sku": sku,
            "product_name": t.product_name or o.get("product_name") or p.get("product_name") or "",
            "issue": _norm_issue(t.issue),
            "status": t.ticket_status,
            "claim_amount": _f(t.claim_amount) if t.claim_amount is not None else None,
            "product_cost": _f(cost),
            "priced": cost > 0,
            "loss": _f(cost) if rejected else 0.0,
            "order_date": od.isoformat() if od else None,
            "created": created.isoformat() if created else None,
            # Which period a ticket belongs to: its order's date, like profit;
            # the ticket's own date only when the order isn't on file.
            "_day": od or created,
            "reopen_by": t.reopen_validity.isoformat() if t.reopen_validity else None,
            "reopenable": bool(rejected and t.reopen_validity and t.reopen_validity >= today),
            "payment_state": t.payment_state,
            "reason": _first_sentence(t.last_update) if rejected else "",
        })

    def summarise(items):
        decided = [r for r in items if r["status"] in ("APPROVED", "REJECTED")]
        rejected = [r for r in items if r["status"] == "REJECTED"]
        approved = [r for r in items if r["status"] == "APPROVED"]
        open_ = [r for r in items if r["status"] == "OPEN"]
        rej_rate = len(rejected) / len(decided) if decided else None
        at_risk = sum(r["product_cost"] for r in open_)
        return {
            "raised": len(items),
            "approved": len(approved),
            "rejected": len(rejected),
            "open": len(open_),
            "rejection_rate": round(rej_rate * 100, 1) if rej_rate is not None else None,
            "rejected_loss": round(sum(r["loss"] for r in rejected), 2),
            "approved_amount": round(sum(r["claim_amount"] or 0 for r in approved), 2),
            "open_at_risk": round(at_risk, 2),
            # What the open ones will probably cost, if they fare like past ones.
            "open_expected_loss": round(at_risk * rej_rate, 2) if rej_rate is not None else None,
            "unpriced": sum(1 for r in items if not r["priced"]),
        }

    def in_window(r, a, b):
        return r["_day"] is not None and a <= r["_day"] <= b

    period = [r for r in rows if in_window(r, win["date_from"], win["date_to"])]
    previous = [r for r in rows if in_window(r, win["prev_from"], win["prev_to"])]

    by_issue = defaultdict(list)
    for r in rows:
        by_issue[r["issue"]].append(r)
    issues = []
    for issue, items in by_issue.items():
        s = summarise(items)
        issues.append({"issue": issue, **s})
    issues.sort(key=lambda x: (-x["rejected_loss"], -x["raised"]))

    by_sku = defaultdict(list)
    for r in rows:
        if r["sku"]:
            by_sku[r["sku"]].append(r)
    skus = [{"sku": sku, "product_name": items[0]["product_name"], **summarise(items)} for sku, items in by_sku.items()]
    skus.sort(key=lambda x: (-x["rejected_loss"], -x["raised"]))

    reasons = Counter(r["reason"][:120] for r in rows if r["status"] == "REJECTED" and r["reason"])
    reopenable = sorted((r for r in rows if r["reopenable"]), key=lambda r: r["reopen_by"])

    for r in rows:
        r.pop("_day", None)
    rejected_rows = sorted((r for r in rows if r["status"] == "REJECTED"), key=lambda r: -r["loss"])
    return {
        "uploaded": True,
        "last_ticket": max((r["created"] for r in rows if r["created"]), default=None),
        "period": summarise(period),
        "previous": summarise(previous),
        "all_time": summarise(rows),
        "by_issue": issues[:15],
        "by_sku": skus[:15],
        "top_rejection_reasons": [{"reason": k, "count": n} for k, n in reasons.most_common(8)],
        "reopenable": reopenable[:MAX_ROWS_LISTED],
        "reopenable_value": round(sum(r["product_cost"] for r in reopenable), 2),
        "rejected": rejected_rows[:MAX_ROWS_LISTED],
    }


# ── Payments ─────────────────────────────────────────────────────────────────

def payment_window(business, date_from, date_to):
    """Payments run on their own calendar (payment date), and usually a few
    days ahead of the orders sheet, so they get their own window: the period
    asked for, or the last 30 days of payments."""
    from .models import OrderPayment
    from .views import _parse_day

    last = OrderPayment.objects.filter(business=business).aggregate(d=Max("payment_date"))["d"]
    if not last:
        return None
    d_to = _parse_day(date_to) or last
    d_from = _parse_day(date_from) or (d_to - timedelta(days=29))
    if d_to < d_from:
        d_from, d_to = d_to, d_from
    d_to = min(d_to, last)
    if d_from > d_to:
        return None
    if (d_to - d_from).days + 1 > 92:
        d_from = d_to - timedelta(days=91)
    days = (d_to - d_from).days + 1
    prev_to = d_from - timedelta(days=1)
    return {"date_from": d_from, "date_to": d_to, "prev_from": prev_to - timedelta(days=days - 1),
            "prev_to": prev_to, "days": days, "last_payment": last}


def _adjustment_reason(row):
    """One label per adjustment row. Claim reasons carry an AWB number that
    makes every one unique, so that part is dropped."""
    for field in ("recovery_reason", "claims_reason", "compensation_reason"):
        v = (row.get(field) or "").strip()
        if v:
            return re.sub(r"\s+for AWB:.*$", "", v, flags=re.IGNORECASE)
    return "Other adjustment"


def _row_out(r, **extra):
    return {
        "sub_order_no": r["sub_order_no"], "sku": r.get("supplier_sku") or "",
        "status": r.get("live_order_status") or "Adjustment",
        "payment_date": r["payment_date"].isoformat() if r.get("payment_date") else None,
        "settlement": _f(r.get("final_settlement_amount")), **extra,
    }


def payment_checks(business, pwin):
    from .insights import count_change_z
    from .models import OrderPayment
    from .views import _DELIVERED_STATUSES

    fields = ("id", "sub_order_no", "supplier_sku", "live_order_status", "payment_date", "final_settlement_amount",
              "listing_price_incl_taxes", "return_shipping_charge", "shipping_charge_incl_gst", "transaction_id",
              "recovery", "claims", "compensation", "recovery_reason", "claims_reason", "compensation_reason",
              "return_premium", "return_premium_of_return", "quantity")
    base = OrderPayment.objects.filter(business=business)
    cur = list(base.filter(payment_date__range=(pwin["date_from"], pwin["date_to"])).values(*fields))
    prev = list(base.filter(payment_date__range=(pwin["prev_from"], pwin["prev_to"])).values(*fields))
    checks = []

    def add(key, title, severity, rows, detail, action, amount=0.0, **extra):
        if not rows and not extra.get("force"):
            return
        extra.pop("force", None)
        checks.append({"key": key, "title": title, "severity": severity, "count": len(rows),
                       "amount": round(amount, 2), "detail": detail, "action": action,
                       "rows": rows[:MAX_ROWS_LISTED], **extra})

    # SKU norms from all history, so one period can't hide its own outliers.
    history = list(base.filter(payment_date__lt=pwin["date_from"])
                   .values("supplier_sku", "return_shipping_charge", "shipping_charge_incl_gst", "quantity"))
    ret_norm, ship_norm = defaultdict(list), defaultdict(list)
    for h in history:
        if h["return_shipping_charge"]:
            ret_norm[h["supplier_sku"]].append(abs(float(h["return_shipping_charge"])))
        if h["shipping_charge_incl_gst"]:
            ship_norm[h["supplier_sku"]].append(_per_unit(h["shipping_charge_incl_gst"], h))

    # 1. Return fees above ₹200.
    high_ret = []
    for r in cur:
        fee = r["return_shipping_charge"]
        if fee is not None and abs(fee) > HIGH_RETURN_FEE:
            usual = _median(ret_norm.get(r["supplier_sku"], []))
            high_ret.append(_row_out(r, fee=_f(abs(fee)), usual_fee=round(usual, 2) if usual else None, qty=_qty(r)))
    high_ret.sort(key=lambda x: -x["fee"])
    add("high_return_fee", f"{len(high_ret)} return(s) charged more than ₹200 return shipping",
        "critical" if len(high_ret) >= 10 else "warning", high_ret,
        "A normal return costs well under ₹200. Charges above that usually mean the parcel was billed in a "
        "heavier weight slab, or charged twice.",
        "Check the product's declared weight and packed size on Meesho; raise a ticket for any charge that "
        "doesn't match the parcel, with a photo of the packed parcel on a scale.",
        amount=sum(x["fee"] for x in high_ret))

    # 2. Forward shipping: per-SKU jump vs the previous period, and single outliers.
    def ship_by_sku(rows):
        out = defaultdict(list)
        for r in rows:
            if r["shipping_charge_incl_gst"] and (r["live_order_status"] or "").upper() in _DELIVERED_STATUSES:
                out[r["supplier_sku"]].append(_per_unit(r["shipping_charge_incl_gst"], r))
        return out
    now_ship, before_ship = ship_by_sku(cur), ship_by_sku(prev)
    jumps = []
    for sku, vals in now_ship.items():
        old = before_ship.get(sku) or ship_norm.get(sku) or []
        if len(vals) >= 5 and len(old) >= 5:
            a, b = _median(vals), _median(old)
            if a >= b + 15 and a >= b * 1.25:
                jumps.append({"sku": sku, "now": round(a, 2), "before": round(b, 2), "orders": len(vals),
                              "extra_cost": round((a - b) * len(vals), 2)})
    jumps.sort(key=lambda x: -x["extra_cost"])
    add("shipping_jump", f"Shipping charge went up on {len(jumps)} SKU(s)", "warning", jumps,
        "The typical forward-shipping charge per order for these SKUs rose sharply compared with before — "
        "usually Meesho re-measured the parcel into a heavier weight slab.",
        "Re-check the weight and dimensions on these listings, pack them smaller/lighter if you can, and raise "
        "a weight dispute if the parcel really is lighter than charged.",
        amount=sum(x["extra_cost"] for x in jumps))

    odd_ship = []
    for r in cur:
        v = r["shipping_charge_incl_gst"]
        norm = ship_norm.get(r["supplier_sku"], [])
        if v and len(norm) >= 10:
            m = _median(norm)
            per_unit = _per_unit(v, r)
            if per_unit > max(2 * m, m + 40):
                odd_ship.append(_row_out(r, shipping=round(per_unit, 2), usual=round(m, 2), qty=_qty(r)))
    odd_ship.sort(key=lambda x: -(x["shipping"] - x["usual"]))
    add("shipping_outlier", f"{len(odd_ship)} order(s) charged far more shipping than usual for their SKU",
        "warning", odd_ship,
        "Each of these was charged at least double the SKU's normal shipping per unit.",
        "Open a few on Meesho and check the billed weight; dispute the ones that are wrong.",
        amount=sum(x["shipping"] - x["usual"] for x in odd_ship))

    # 3. Sub-orders with many payment rows.
    sub_set = {r["sub_order_no"] for r in cur}
    all_rows = defaultdict(list)
    for r in base.filter(sub_order_no__in=sub_set).values(*fields):
        all_rows[r["sub_order_no"]].append(r)
    many = []
    for sub, rs in all_rows.items():
        if len(rs) >= 4:
            many.append({"sub_order_no": sub, "sku": next((x["supplier_sku"] for x in rs if x["supplier_sku"]), ""),
                         "rows": len(rs), "statuses": ", ".join(sorted({x["live_order_status"] or _adjustment_reason(x) for x in rs})),
                         "net": _f(sum(x["final_settlement_amount"] or 0 for x in rs))})
    many.sort(key=lambda x: (-x["rows"], x["net"]))
    add("many_rows", f"{len(many)} sub-order(s) with 4 or more payment rows", "info", many,
        "Most orders settle in one or two rows. Four or more means it was charged, reversed and adjusted "
        "several times — worth checking that the total is right.",
        "Open these on Meesho's payments page and check the net matches what you expect for the outcome.")

    # 4. The same adjustment charged twice. (Order-status rows can't repeat —
    # the database keeps one per sub-order, status and date — but fee and
    # recovery lines have no status and can.)
    dup_key = Counter((r["sub_order_no"], _adjustment_reason(r), r["final_settlement_amount"], r["payment_date"])
                      for r in cur if not r["live_order_status"])
    dups = [{"sub_order_no": k[0], "status": k[1], "settlement": _f(k[2]),
             "payment_date": k[3].isoformat() if k[3] else None, "times": n}
            for k, n in dup_key.items() if n > 1]
    add("duplicates", f"{len(dups)} adjustment(s) charged more than once on the same day", "warning", dups,
        "Same sub-order, same fee or recovery, same amount, same date — listed more than once.",
        "Check these against Meesho's payments page and raise a ticket for any real double charge.",
        amount=sum(abs(d["settlement"]) * (d["times"] - 1) for d in dups))

    # 5. Adjustments: new types, unusual one-offs, and volume changes.
    def adjustments(rows):
        out = defaultdict(lambda: {"count": 0, "amount": 0.0, "rows": []})
        for r in rows:
            if r["live_order_status"]:
                continue
            reason = _adjustment_reason(r)
            g = out[reason]
            g["count"] += 1
            g["amount"] += float(r["final_settlement_amount"] or 0)
            g["rows"].append(r)
        return out
    adj_now, adj_before = adjustments(cur), adjustments(prev)
    adj_table = []
    for reason in set(adj_now) | set(adj_before):
        a, b = adj_now.get(reason), adj_before.get(reason)
        n, m = (a["count"] if a else 0), (b["count"] if b else 0)
        adj_table.append({"reason": reason, "count": n, "prev_count": m,
                          "amount": round(a["amount"], 2) if a else 0.0,
                          "prev_amount": round(b["amount"], 2) if b else 0.0,
                          "z": round(count_change_z(n, m), 2), "new": bool(n and not m)})
    adj_table.sort(key=lambda x: -abs(x["amount"]))

    unusual = []
    for reason, g in adj_now.items():
        if reason.lower() in ROUTINE_RECOVERIES:
            continue
        for r in g["rows"]:
            amt = float(r["final_settlement_amount"] or 0)
            if amt < 0:
                unusual.append(_row_out(r, reason=reason))
    unusual.sort(key=lambda x: x["settlement"])
    add("unusual_deductions", f"{len(unusual)} one-off deduction(s) by Meesho", "warning", unusual,
        "Deductions other than the routine affiliate and return-assurance fees — e.g. orders marked delivered "
        "and then recovered, or missing-item penalties. These are the ones most worth disputing.",
        "Read the reason for each; if the order was genuinely delivered complete, raise a ticket with the "
        "packing video and dispatch proof.",
        amount=-sum(x["settlement"] for x in unusual))

    spikes = [a for a in adj_table if (a["new"] and a["count"] >= 3) or (a["z"] >= 3 and a["count"] >= 10)]
    add("adjustment_spike", f"{len(spikes)} adjustment type(s) suddenly more frequent", "warning", spikes,
        "Compared with the previous period, these adjustment lines appear far more often (or are new).",
        "Find out what changed — a new Meesho fee, a program you were enrolled in, or a run of disputes.",
        amount=-sum(min(a["amount"], 0) - min(a["prev_amount"], 0) for a in spikes))

    # 6. What Meesho keeps per delivered order.
    def kept_share(rows):
        out = []
        for r in rows:
            lp, fs = r["listing_price_incl_taxes"], r["final_settlement_amount"]
            if (r["live_order_status"] or "").upper() in _DELIVERED_STATUSES and lp and lp > 0 and fs is not None:
                out.append(float((lp - fs) / lp) * 100)
        return out
    k_now, k_before = kept_share(cur), kept_share(prev)
    fee_drift = None
    if len(k_now) >= 30 and len(k_before) >= 30:
        a, b = _median(k_now), _median(k_before)
        fee_drift = {"now": round(a, 1), "before": round(b, 1), "orders": len(k_now)}
        if a - b >= 3:
            add("fee_drift", f"Meesho keeps {a:.1f}% of the price per delivered order, up from {b:.1f}%",
                "warning", [fee_drift],
                "The gap between the listing price and what reaches you grew on a typical delivered order — "
                "higher fees, shipping, or a change in price type.",
                "Compare a recent delivered order's breakdown with an older one on the payments page, and "
                "re-price SKUs whose margin no longer covers it.")

    # 7. Delivered orders that paid nothing or took money.
    neg = [_row_out(r) for r in cur
           if (r["live_order_status"] or "").upper() in _DELIVERED_STATUSES
           and r["final_settlement_amount"] is not None and r["final_settlement_amount"] <= 0]
    add("delivered_no_pay", f"{len(neg)} delivered order(s) settled at ₹0 or less", "critical" if neg else "info", neg,
        "A delivered order should pay out. Zero or negative usually means it was reversed or charged in full.",
        "Check each one on Meesho; if it was delivered and not returned, raise a payment ticket.",
        amount=-sum(x["settlement"] for x in neg))

    def totals(rows):
        subs = {r["sub_order_no"] for r in rows}
        adj = sum(1 for r in rows if not r["live_order_status"])
        return {"rows": len(rows), "sub_orders": len(subs), "adjustment_rows": adj,
                "rows_per_order": round(len(rows) / len(subs), 2) if subs else None,
                "net": _f(sum(r["final_settlement_amount"] or 0 for r in rows))}

    order = {"critical": 0, "warning": 1, "info": 2}
    checks.sort(key=lambda c: (order.get(c["severity"], 9), -abs(c["amount"])))
    return {
        "period": {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in pwin.items()},
        "summary": totals(cur), "previous": totals(prev),
        "checks": checks, "adjustments": adj_table[:20], "fee_share": fee_drift,
    }
