"""
Meesho Ads dashboard (Meesho → Ads), from what the sync worker reads off the
panel's Advertisement page every few minutes (MeeshoAdsJob → MeeshoAdCampaign,
MeeshoAdCatalog, MeeshoAdCatalogDay, MeeshoAdDay) and the auto-pause log
(MeeshoAdPause).

Two kinds of ROI:
  Meesho's ROI   ad revenue ÷ ad spend — what the panel shows. Revenue is the
                 ad orders' selling value, before returns, before costs.
  True ROI       what the ads earned after everything: each catalog's ad orders
                 × what an order of that catalog actually nets us (settled
                 payments less item, packaging and tax cost, returns and RTOs
                 included — the profit engine's own figure, over the last
                 ECON_DAYS of orders), less the ad cost with GST (spend × 1.18,
                 what Meesho deducts). Break-even cost per order = that net per
                 order: spend more than that per order and the ad loses money.

Actions (admin): Refresh (read now), pause / resume a catalog in a live
campaign, and the auto-pause rule (MeeshoAutoSetting.ads_*).
"""

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db.models import Max, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import (
    AdsCost, MeeshoAdCampaign, MeeshoAdCatalog, MeeshoAdCatalogDay, MeeshoAdDay, MeeshoAdPause, MeeshoAutoSetting,
    MeeshoSyncRun, MeeshoSyncSetting, Order, OrderPayment,
)

KIND_ADS = "ADS"
ADS_JOB = "MeeshoAdsJob"
EDIT_JOB = "MeeshoAdEditJob"
GST = Decimal("1.18")
ECON_DAYS = 120                  # orders a catalog's net per order is taken over
RANGE_DEFAULT = 30
MIN_ORDERS_FOR_VERDICT = 3       # fewer ad orders: too early to judge, unless it has spent past break-even with none
SPEND_LIMIT = (Decimal("5"), Decimal("5000"))
FIGURES = ("spend", "revenue", "orders", "views", "clicks")
Z = Decimal("0")


def _bulk():
    from . import meesho_bulk
    return meesho_bulk


def _views():
    from . import views
    return views


def _ist_today():
    return timezone.localdate(timezone.now(), timezone=timezone.get_fixed_timezone(330))


def _f(x):
    return float(round(Decimal(x or 0), 2))


def _ratios(spend, revenue, orders, views, clicks):
    """The panel's ratios, worked out from the sums (never averaged)."""
    spend, revenue = Decimal(spend or 0), Decimal(revenue or 0)
    return {
        "roi": _f(revenue / spend) if spend else None,
        "cpo": _f(spend / orders) if orders else None,
        "aov": _f(revenue / orders) if orders else None,
        "cpc": _f(spend / clicks) if clicks else None,
        "ctr": round(clicks / views * 100, 2) if views else None,
        "cvr": round(orders / clicks * 100, 2) if clicks else None,
    }


def _sum(rows):
    t = {k: Z if k in ("spend", "revenue") else 0 for k in FIGURES}
    for r in rows:
        for k in FIGURES:
            t[k] += getattr(r, k) if not isinstance(r, dict) else r[k]
    return t


def _figs(t):
    return {"spend": _f(t["spend"]), "revenue": _f(t["revenue"]), "orders": t["orders"], "views": t["views"],
            "clicks": t["clicks"], "cost_with_gst": _f(Decimal(t["spend"]) * GST), **_ratios(*(t[k] for k in FIGURES))}


def _range(request):
    today = _ist_today()
    try:
        to = date.fromisoformat(request.GET.get("date_to") or "")
    except ValueError:
        to = today
    try:
        frm = date.fromisoformat(request.GET.get("date_from") or "")
    except ValueError:
        frm = to - timedelta(days=RANGE_DEFAULT - 1)
    if frm > to:
        frm, to = to, frm
    return frm, min(to, today), today


# ── What an order of each catalog really nets ────────────────────────────────

def catalog_economics(business, catalog_ids, request, today=None):
    """
    {catalog_id: {...}} — over the orders of the last ECON_DAYS with payments:
    net per order (settled amount less item, packaging and tax cost; a return or
    RTO counts with its loss, a cancellation as 0), how many were resolved, how
    many could be priced, the return share, and how many were ad orders.
    Orders still with the courier (not resolved) are left out; so are orders
    whose SKU has no cost price (counted in `unpriced`).
    """
    v = _views()
    catalog_ids = [int(c) for c in catalog_ids if c]
    if not catalog_ids:
        return {}
    since = (today or _ist_today()) - timedelta(days=ECON_DAYS)
    pe = v._pricing_engine(business)
    cost_setting = v._cost_setting(business)
    statuses = ["Claim", "Cancelled", "Delivered", "Return", "RTO", "Shipped", "Exchange", "Unknown"]
    base = v._apply_settlement_filter(OrderPayment.objects.filter(business=business), request)
    since_at = timezone.make_aware(datetime.combine(since, time.min))   # not order_date__date: MySQL without zone tables gives NULL
    cat_of = dict(base.filter(catalog_id__in=catalog_ids, order_date__gte=since_at)
                  .values_list("sub_order_no", "catalog_id"))
    out = {c: {"orders": 0, "net": Z, "delivered": 0, "returned": 0, "cancelled": 0, "unpriced": 0, "ad_orders": 0,
               "ad_net": Z} for c in catalog_ids}
    if not cat_of:
        return out
    rows = defaultdict(list)
    subs = list(cat_of)
    for i in range(0, len(subs), 1000):
        for p in base.filter(sub_order_no__in=subs[i:i + 1000]).only(
                "sub_order_no", "supplier_sku", "quantity", "final_settlement_amount", "live_order_status", "recovery_reason",
                "claims", "return_shipping_charge", "order_date", "payment_date", "order_source", "catalog_id",
                "total_sale_amount", "product_gst_percent").order_by("-payment_date"):
            rows[p.sub_order_no].append(p)
    orders = {}
    for i in range(0, len(subs), 1000):
        for o in Order.objects.filter(business=business, sub_order_no__in=subs[i:i + 1000]).values("sub_order_no", "sku", "quantity"):
            orders.setdefault(o["sub_order_no"], o)
    for sub, payments in rows.items():
        c = out.get(cat_of.get(sub))
        if c is None:
            continue
        primary = next((p for p in payments if p.live_order_status), payments[0])
        o = orders.get(sub) or {}
        sku = o.get("sku") or primary.supplier_sku
        qty = o.get("quantity") or primary.quantity or 1
        price = pe["get_eff_price"](sku, primary.order_date) if sku and sku in pe["price_map"] else None
        if not price or not v._has_unit_price(price[2]):
            c["unpriced"] += 1
            continue
        res = v.compute_order_net(payments, price[0], price[1], qty, statuses, price[2], price[3], cost_setting=cost_setting)
        st = (res.get("status") or "").lower()
        if st in ("shipped", "unknown", ""):
            continue                                  # not resolved yet
        net = Decimal(str(res["net"] or 0))
        c["orders"] += 1
        c["net"] += net
        if st in ("return", "rto"):
            c["returned"] += 1
        elif st == "cancelled":
            c["cancelled"] += 1
        elif st not in ("claim", "exchange"):
            c["delivered"] += 1
        if any(p.order_source == "Ad order" for p in payments):
            c["ad_orders"] += 1
            c["ad_net"] += net
    return out


def _econ_json(e):
    n = e["orders"]
    return {
        "orders": n, "unpriced": e["unpriced"], "delivered": e["delivered"], "returned": e["returned"],
        "net_per_order": _f(e["net"] / n) if n else None,
        "return_pct": round(e["returned"] / n * 100, 1) if n else None,
        "ad_orders_settled": e["ad_orders"],
        "ad_net_per_order": _f(e["ad_net"] / e["ad_orders"]) if e["ad_orders"] else None,
    }


def _verdict(spend, orders, npo, revenue):
    """(code, words) — what to do with a catalog's ads, by its true numbers."""
    cost = Decimal(spend) * GST
    if npo is None:
        return "no_cost", "Add the SKU cost price to judge this catalog"
    npo = Decimal(str(npo))
    if npo <= 0:
        return "loss_anyway", "Its orders lose money even without ads — fix the price before advertising"
    if orders == 0:
        if cost >= npo:
            return "pause", f"₹{_f(cost):.0f} spent (with GST), no order — more than an order would earn (₹{_f(npo):.0f})"
        return "learning", "Too early — no order yet, spend still under one order's profit"
    profit = npo * orders - cost
    cpo = cost / orders
    if orders < MIN_ORDERS_FOR_VERDICT:
        return ("learning", f"{orders} order{'s' if orders != 1 else ''} so far — cost per order ₹{_f(cpo):.0f} "
                            f"vs ₹{_f(npo):.0f} earned per order")
    if profit > 0 and cpo <= npo * Decimal("0.5"):
        return "scale", f"Earns ₹{_f(profit):.0f} after ads — cost per order is under half the profit per order: budget can go up"
    if profit > 0:
        return "keep", f"Earns ₹{_f(profit):.0f} after ads — cost per order ₹{_f(cpo):.0f} of ₹{_f(npo):.0f}"
    return "losing", f"Loses ₹{_f(-profit):.0f} after ads — cost per order ₹{_f(cpo):.0f} is more than ₹{_f(npo):.0f} earned per order"


# ── The dashboard ────────────────────────────────────────────────────────────

def account_dashboard(account, request, frm, to, today):
    setting = MeeshoAutoSetting.get()
    limit = Decimal(setting.ads_pause_spend or 0)
    days = list(MeeshoAdDay.objects.filter(account=account, date__gte=frm, date__lte=to).order_by("date"))
    by_day = {d.date: d for d in days}
    series = []
    d = frm
    while d <= to:
        r = by_day.get(d)
        series.append({"date": d, "read": bool(r), **({k: (_f(getattr(r, k)) if k in ("spend", "revenue") else getattr(r, k))
                                                       for k in FIGURES} if r else {k: 0 for k in FIGURES})})
        d += timedelta(days=1)

    campaigns = list(MeeshoAdCampaign.objects.filter(account=account).order_by("-start_at"))
    live_ids = {c.campaign_id for c in campaigns if c.status == "LIVE"}
    ad_cats = list(MeeshoAdCatalog.objects.filter(account=account))
    cat_days = list(MeeshoAdCatalogDay.objects.filter(account=account, date__gte=frm, date__lte=to))
    today_rows = {(r.campaign_id, r.catalog_id): r for r in MeeshoAdCatalogDay.objects.filter(account=account, date=today)}

    # Per catalog, every campaign together: lifetime (from each campaign's catalog figures) and the range (days read).
    cats = {}
    for c in ad_cats:
        x = cats.setdefault(c.catalog_id, {"catalog_id": c.catalog_id, "name": c.name, "image": c.image, "category": c.category,
                                           "campaigns": [], "life": [], "range": [], "live_in": []})
        x["name"] = x["name"] or c.name
        x["image"] = x["image"] or c.image
        x["campaigns"].append(c.campaign_id)
        x["life"].append(c)
        if c.campaign_id in live_ids:
            x["live_in"].append({"campaign_id": c.campaign_id, "status": c.status, "status_reason": c.status_reason,
                                 "bid": _f(c.bid) if c.bid is not None else None})
    for r in cat_days:
        if r.catalog_id in cats:
            cats[r.catalog_id]["range"].append(r)
    econ = catalog_economics(account.business, list(cats), request, today)
    catalogs = []
    for cid, x in cats.items():
        life = _sum(x["life"])
        e = _econ_json(econ.get(cid) or {"orders": 0, "net": Z, "delivered": 0, "returned": 0, "cancelled": 0,
                                         "unpriced": 0, "ad_orders": 0, "ad_net": Z})
        npo = e["net_per_order"]
        cost = Decimal(life["spend"]) * GST
        true_profit = (Decimal(str(npo)) * life["orders"] - cost) if npo is not None else None
        code, words = _verdict(life["spend"], life["orders"], npo, life["revenue"])
        catalogs.append({
            "catalog_id": cid, "name": x["name"], "image": x["image"], "category": x["category"],
            "campaigns": len(set(x["campaigns"])), "live_in": x["live_in"],
            "lifetime": _figs(life), "range": _figs(_sum(x["range"])) if x["range"] else None,
            "economics": e,
            "breakeven_cpo": npo,
            "breakeven_roi": _f(Decimal(str(_ratios(*(life[k] for k in FIGURES))["aov"] or 0)) * GST / Decimal(str(npo)))
            if npo and npo > 0 and life["orders"] else None,
            "true_profit": _f(true_profit) if true_profit is not None else None,
            "true_roi_pct": round(float(true_profit / cost * 100), 1) if true_profit is not None and cost else None,
            "verdict": code, "verdict_text": words,
        })
    catalogs.sort(key=lambda c: (-len(c["live_in"]), -c["lifetime"]["spend"]))

    # Today, live: each catalog's spend against the rule.
    live_today = []
    for (camp_id, cid), r in sorted(today_rows.items(), key=lambda kv: -kv[1].spend):
        if camp_id not in live_ids:
            continue
        ac = next((c for c in ad_cats if c.campaign_id == camp_id and c.catalog_id == cid), None)
        state = ac.status if ac else ""
        due = state == "ACTIVE" and r.spend > limit and r.orders <= setting.ads_pause_orders
        live_today.append({"campaign_id": camp_id, "catalog_id": cid, "name": ac.name if ac else "", "image": ac.image if ac else "",
                           "status": state, "status_reason": ac.status_reason if ac else "",
                           **{k: (_f(getattr(r, k)) if k in ("spend", "revenue") else getattr(r, k)) for k in FIGURES},
                           **_ratios(*(getattr(r, k) for k in FIGURES)),
                           "read_at": r.read_at, "over_limit": bool(due),
                           "left_before_pause": _f(max(limit - r.spend, Z)) if state == "ACTIVE" and r.orders <= setting.ads_pause_orders else None})

    # Spend the panel shows vs what Meesho deducted in payments (the payment file's Ads Cost sheet).
    panel = _sum(days)
    deducted = AdsCost.objects.filter(business=account.business, deduction_date__gte=frm, deduction_date__lte=to) \
        .aggregate(t=Sum("total_ads_cost"))["t"]

    # True profit over the range: each catalog's range orders × its net per order, less the range's cost.
    priced_spend = Z
    range_profit = Z
    unpriced_spend = Z
    for c in catalogs:
        rg = c["range"]
        if not rg:
            continue
        if c["economics"]["net_per_order"] is None:
            unpriced_spend += Decimal(str(rg["spend"]))
            continue
        priced_spend += Decimal(str(rg["spend"]))
        range_profit += Decimal(str(c["economics"]["net_per_order"])) * rg["orders"] - Decimal(str(rg["spend"])) * GST

    last = MeeshoSyncRun.objects.filter(account=account, kind=KIND_ADS).order_by("-queued_at").first()
    last_ok = MeeshoSyncRun.objects.filter(account=account, kind=KIND_ADS, status=MeeshoSyncRun.STATUS_OK).aggregate(t=Max("finished_at"))["t"]
    totals = _figs(panel)
    return {
        "business_id": account.business_id, "business": account.business.name,
        "last_read": last_ok, "last_run": {"status": last.status, "message": last.message, "at": last.finished_at or last.queued_at} if last else None,
        "range": {"from": frm, "to": to, "days": (to - frm).days + 1, "days_read": len(days)},
        "totals": totals,
        "true": {"profit": _f(range_profit), "spend_judged": _f(priced_spend), "spend_unpriced": _f(unpriced_spend),
                 "note": "From the live campaigns' daily figures (read since the ads sync started)."},
        "deducted": {"ads_cost": _f(abs(deducted)) if deducted is not None else None,
                     "panel_with_gst": totals["cost_with_gst"]},
        "series": series,
        "today": {"date": today, **(_figs(_sum([by_day[today]])) if today in by_day else _figs(_sum([]))), "catalogs": live_today},
        "campaigns": [{
            "campaign_id": c.campaign_id, "name": c.name, "status": c.status, "reason": c.reason, "type": c.campaign_type,
            "bid_type": c.bid_type, "bid": _f(c.bid) if c.bid is not None else None, "budget": _f(c.total_budget),
            "start": c.start_at, "end": c.end_at, "catalog_count": c.catalog_count, "image": c.image,
            "feedback": c.feedback_state, **_figs({k: getattr(c, k) for k in FIGURES}),
        } for c in campaigns],
        "catalogs": catalogs,
        "insights": _insights(catalogs, totals, live_today, setting),
        "pauses": [{
            "id": p.id, "campaign_id": p.campaign_id, "catalog_id": p.catalog_id, "name": p.catalog_name, "action": p.action,
            "trigger": p.trigger, "status": p.status, "date": p.date, "spend": _f(p.spend), "orders": p.orders,
            "limit": _f(p.limit) if p.limit is not None else None, "message": p.message, "at": p.created_at, "done_at": p.done_at,
            "by": p.created_by.username if p.created_by else None,
        } for p in MeeshoAdPause.objects.filter(account=account).select_related("created_by")[:100]],
    }


def _insights(catalogs, totals, live_today, setting):
    """Plain-words findings, the most money first."""
    out = []
    losing = [c for c in catalogs if c["verdict"] in ("losing", "pause") and c["lifetime"]["spend"] > 0]
    if losing:
        lost = sum(-(c["true_profit"] or 0) for c in losing if (c["true_profit"] or 0) < 0)
        live = [c for c in losing if c["live_in"]]
        out.append({"level": "bad", "title": f"{len(losing)} catalogs lose money on ads (₹{lost:,.0f} after GST)",
                    "detail": (f"{len(live)} of them are still in a live campaign: " + ", ".join(c["name"] or str(c["catalog_id"]) for c in live[:5]))
                    if live else "None of them is in a live campaign now."})
    scale = [c for c in catalogs if c["verdict"] == "scale"]
    if scale:
        out.append({"level": "good", "title": f"{len(scale)} catalogs earn well on ads — room to spend more",
                    "detail": ", ".join(f"{c['name'] or c['catalog_id']} (₹{c['true_profit']:,.0f})" for c in scale[:5])})
    nocost = [c for c in catalogs if c["verdict"] == "no_cost" and c["lifetime"]["spend"] > 0]
    if nocost:
        out.append({"level": "warn", "title": f"{len(nocost)} advertised catalogs have no cost price — their true ROI can't be worked out",
                    "detail": "Add the SKU prices on SKU Pricing: " + ", ".join(c["name"] or str(c["catalog_id"]) for c in nocost[:5])})
    loss_anyway = [c for c in catalogs if c["verdict"] == "loss_anyway" and c["live_in"]]
    if loss_anyway:
        out.append({"level": "bad", "title": f"{len(loss_anyway)} live catalogs lose money per order even without ads",
                    "detail": ", ".join(c["name"] or str(c["catalog_id"]) for c in loss_anyway[:5])})
    if totals["roi"] is not None:
        priced = [c for c in catalogs if c["breakeven_roi"]]
        if priced:
            be = sum(c["breakeven_roi"] * c["lifetime"]["spend"] for c in priced) / max(sum(c["lifetime"]["spend"] for c in priced), 1)
            out.append({"level": "good" if totals["roi"] >= be else "bad",
                        "title": f"Meesho ROI {totals['roi']:.2f} in these days — break-even is about {be:.2f}",
                        "detail": "Break-even ROI = order value × 1.18 ÷ what an order earns: below it, the ads cost more than the orders bring in."})
    near = [x for x in live_today if x["left_before_pause"] is not None and x["left_before_pause"] < 10 and x["spend"] > 0]
    if setting.ads_auto_pause and near:
        out.append({"level": "warn", "title": f"{len(near)} live catalogs are within ₹10 of the auto-pause",
                    "detail": ", ".join(f"{x['name'] or x['catalog_id']} (₹{x['spend']:.0f} today)" for x in near[:5])})
    if not setting.ads_auto_pause:
        due = [x for x in live_today if x["over_limit"]]
        if due:
            out.append({"level": "warn", "title": f"Auto-pause is off — {len(due)} live catalogs are over ₹{_f(setting.ads_pause_spend):.0f} today with no order",
                        "detail": ", ".join(f"{x['name'] or x['catalog_id']} (₹{x['spend']:.0f})" for x in due[:5])})
    return out


def _rule_json(s):
    return {"auto_pause": s.ads_auto_pause, "spend": _f(s.ads_pause_spend), "orders": s.ads_pause_orders,
            "every": MeeshoSyncSetting.get().ads_every}


@api_view(["GET"])
def dashboard_view(request, business_id):
    """GET meesho-ads/?date_from&date_to — every business on this page: totals, days, campaigns, catalogs, ROI."""
    accounts = _bulk()._accounts(request, business_id)
    frm, to, today = _range(request)
    return Response({"today": today, "rule": _rule_json(MeeshoAutoSetting.get()),
                     "admin": _views()._is_admin(request.user),
                     "businesses": [account_dashboard(a, request, frm, to, today) for a in accounts]})


def _enqueue_or_503(job, args, on_fail):
    try:
        _bulk()._ms().enqueue(job, args, retry=False)
    except Exception as exc:                               # noqa: BLE001 — nothing was sent
        on_fail(exc)
        return Response({"error": "The job queue (Redis) isn't reachable — nothing was sent to Meesho."},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return None


@api_view(["POST"])
def refresh_view(request, business_id):
    """POST meesho-ads/refresh/ {businesses} — read Meesho Ads now."""
    b = _bulk()
    accounts = b._wanted(request, b._accounts(request, business_id))
    runs = []
    for a in accounts:
        if problem := b._account_problem(a):
            return Response({"error": f"{a.business.name}: {problem}"}, status=status.HTTP_400_BAD_REQUEST)
        if b._busy(a, [KIND_ADS]):
            continue
        run = MeeshoSyncRun.objects.create(account=a, kind=KIND_ADS, trigger=MeeshoSyncRun.TRIGGER_MANUAL, message="Reading Meesho Ads…")
        fail = lambda exc, run=run: MeeshoSyncRun.objects.filter(pk=run.pk).update(
            status=MeeshoSyncRun.STATUS_FAILED, finished_at=timezone.now(), message=f"Could not reach the job queue ({exc}).")
        if err := _enqueue_or_503(ADS_JOB, [a.pk, run.pk, MeeshoSyncRun.TRIGGER_MANUAL], fail):
            return err
        runs.append(run.pk)
    return Response({"runs": runs}, status=status.HTTP_202_ACCEPTED)


@api_view(["POST"])
def catalog_view(request, business_id):
    """POST meesho-ads/catalog/ {business, campaign_id, catalog_id, action: pause|resume} — that catalog in that live campaign."""
    b = _bulk()
    if err := b._admin(request):
        return err
    d = request.data if isinstance(request.data, dict) else {}
    action = {"pause": MeeshoAdPause.ACTION_PAUSE, "resume": MeeshoAdPause.ACTION_RESUME}.get(str(d.get("action")))
    try:
        biz, camp_id, cat_id = int(d.get("business")), int(d.get("campaign_id")), int(d.get("catalog_id"))
    except (TypeError, ValueError):
        return Response({"error": "Say which business, campaign and catalog."}, status=status.HTTP_400_BAD_REQUEST)
    if not action:
        return Response({"error": "action must be pause or resume."}, status=status.HTTP_400_BAD_REQUEST)
    account = next((a for a in b._accounts(request, business_id) if a.business_id == biz), None)
    if not account:
        return Response({"error": "That business isn't on this page."}, status=status.HTTP_403_FORBIDDEN)
    if problem := b._account_problem(account):
        return Response({"error": problem}, status=status.HTTP_400_BAD_REQUEST)
    camp = MeeshoAdCampaign.objects.filter(account=account, campaign_id=camp_id).first()
    cat = MeeshoAdCatalog.objects.filter(account=account, campaign_id=camp_id, catalog_id=cat_id).first()
    if not camp or not cat:
        return Response({"error": "That catalog isn't in that campaign — Refresh first."}, status=status.HTTP_404_NOT_FOUND)
    if camp.status != "LIVE":
        return Response({"error": "That campaign isn't live — nothing to pause or resume in it."}, status=status.HTTP_409_CONFLICT)
    want = "PAUSED" if action == MeeshoAdPause.ACTION_PAUSE else "ACTIVE"
    if cat.status == want:
        return Response({"error": f"It's {want.lower()} in that campaign already."}, status=status.HTTP_409_CONFLICT)
    if MeeshoAdPause.objects.filter(account=account, campaign_id=camp_id, catalog_id=cat_id, status=MeeshoAdPause.QUEUED,
                                    created_at__gte=timezone.now() - timedelta(minutes=10)).exists():
        return Response({"error": "A change to it is already on its way."}, status=status.HTTP_409_CONFLICT)
    today = _ist_today()
    day = MeeshoAdCatalogDay.objects.filter(account=account, campaign_id=camp_id, catalog_id=cat_id, date=today).first()
    p = MeeshoAdPause.objects.create(
        account=account, campaign_id=camp_id, catalog_id=cat_id, catalog_name=cat.name[:255], action=action,
        trigger=MeeshoAdPause.TRIGGER_MANUAL, status=MeeshoAdPause.QUEUED, date=today,
        spend=day.spend if day else 0, orders=day.orders if day else 0,
        created_by=request.user if request.user.is_authenticated else None,
        message=f"{'Paused' if want == 'PAUSED' else 'Set active'} by hand")
    fail = lambda exc: MeeshoAdPause.objects.filter(pk=p.pk).update(status=MeeshoAdPause.FAILED, done_at=timezone.now(),
                                                                     message=f"Not sent — the job queue isn't reachable ({exc}).")
    if err := _enqueue_or_503(EDIT_JOB, [p.pk], fail):
        return err
    return Response({"id": p.pk, "status": p.status}, status=status.HTTP_202_ACCEPTED)


@api_view(["POST"])
def rule_view(request, business_id):
    """POST meesho-ads/rule/ {auto_pause, spend, orders} — the auto-pause rule (every business)."""
    b = _bulk()
    if err := b._admin(request):
        return err
    _views().get_authorized_business(request, business_id)
    d = request.data if isinstance(request.data, dict) else {}
    s = MeeshoAutoSetting.get()
    if "spend" in d:
        try:
            spend = Decimal(str(d["spend"]))
        except Exception:                                  # noqa: BLE001
            return Response({"error": "The spend limit must be a number."}, status=status.HTTP_400_BAD_REQUEST)
        if not SPEND_LIMIT[0] <= spend <= SPEND_LIMIT[1]:
            return Response({"error": f"The spend limit must be between ₹{SPEND_LIMIT[0]} and ₹{SPEND_LIMIT[1]}."},
                            status=status.HTTP_400_BAD_REQUEST)
        s.ads_pause_spend = spend
    if "orders" in d:
        try:
            n = int(d["orders"])
        except (TypeError, ValueError):
            n = -1
        if not 0 <= n <= 20:
            return Response({"error": "Orders allowed must be between 0 and 20."}, status=status.HTTP_400_BAD_REQUEST)
        s.ads_pause_orders = n
    if "auto_pause" in d:
        s.ads_auto_pause = bool(d["auto_pause"]) and d["auto_pause"] not in ("false", "0")
    s.updated_by = request.user if request.user.is_authenticated else None
    s.save()
    return Response({"rule": _rule_json(s)})
