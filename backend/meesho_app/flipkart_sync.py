"""
Flipkart Seller Hub → the app's Flipkart tables, as the Meesho sync does for
Meesho: what the panel shows is written into the same tables the reports'
uploads fill, so every Flipkart screen (profit, overview, SKU analysis, order
scan) sees it without an upload — and an upload later still refreshes it.

  orders    Forward Orders tabs (every refresh reads them) and the Completed tab
            → FlipkartOrder, one row per order item. A status never goes
            backwards (a RETURNED order isn't put back to DELIVERED), as Meesho's.
  payments  Payments > Previous payments → FlipkartPayout (one per transfer);
            each paid transfer's order items (Payments > Transactions, settled)
            → FlipkartOrderPayment, keyed by its UTR — the Settlement Report's
            "NEFT ID", so an uploaded report and the sync land on the same rows.
  upcoming  Payments > Transactions, unsettled → FlipkartOutstandingPayment
            (replaced on every read).

A row an uploaded report wrote keeps its figures (the report breaks them down
further: TCS, TDS, protection fund…); the sync only fills what it lacks, moves
its status on and stamps synced_at.

Before writing, the payments are checked against the other businesses: when
their UTRs (or order items) are already recorded under another business, the
login belongs to that one and nothing is written here.

reconcile_view (flipkart-seller/reconcile/) puts it together: each transfer
against the order items and other charges it paid, and each order item against
its payments — paid, coming, or delivered and still unpaid.
"""

import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import flipkart_seller as fs
from .api_cache import deferred_bumps
from .models import (
    FlipkartOrder, FlipkartOrderPayment, FlipkartOtherCharge, FlipkartOutstandingPayment, FlipkartPayout,
)

IST = ZoneInfo("Asia/Kolkata")
ZERO = Decimal("0")
CENT = Decimal("0.01")

PAYOUT_DAYS = 60            # how far back Previous payments is read
UPCOMING_DAYS = 30          # how far ahead Upcoming is read (Flipkart's longest range)
TABLE_PAGE, TABLE_PAGES = 100, 30
COMPLETED_PAGES = 10        # of ORDER_PAGE (100) shipments
PAYMENT_TYPES = ("POSTPAID", "PREPAID")
UNPAID_AFTER_DAYS = 20      # delivered this long ago and neither paid nor coming: worth chasing

PAYOUTS_QUERY = (
    "query Payments_Previous_Payments_WEB_getTableData($start_date: String, $end_date: String, $neft_id: String, "
    "$page_size: String, $token: String) {\n  payments_fetchPreviousPaymentTableData(\n    start_date: $start_date\n"
    "    end_date: $end_date\n    neft_id: $neft_id\n    page_size: $page_size\n    token: $token\n  ) {\n    data {\n"
    "      utr_number\n      utr_label\n      transfer_amount\n      advice_id\n      payment_date\n      allow_drill_down\n"
    "      settlement_type\n      settlement_status\n      event\n      event_reason\n      __typename\n    }\n"
    "    show_more\n    token\n    total_count\n    __typename\n  }\n}"
)
TABLE_QUERY = (
    "query TransactionPage_getTransactionsTableData($startDate: String, $endDate: String, $param: String, $token: Float!, "
    "$size: Float!, $tabName: String!, $subTabName: String!, $filters: TableFilters, $settlementStatus: String, "
    "$paymentType: String, $viewType: String, $sort: [SortInput!]) {\n  getTransactionTableData(\n    startDate: $startDate\n"
    "    endDate: $endDate\n    size: $size\n    token: $token\n    tab: $tabName\n    subTab: $subTabName\n    param: $param\n"
    "    filters: $filters\n    settlementStatus: $settlementStatus\n    paymentType: $paymentType\n    viewType: $viewType\n"
    "    sort: $sort\n  ) {\n    token\n    size\n    total_count\n    net_amount\n    is_next\n    max_limit_exceeded\n"
    "    transactions {\n      fields {\n        key\n        value\n        __typename\n      }\n      __typename\n    }\n"
    "    __typename\n  }\n}"
)

# Order statuses as Flipkart's Orders report spells them, and how far on each is.
TAB_STATUS = {"pendingToAccept": "APPROVED", "pendingToPack": "APPROVED", "pendingToDispatch": "READY_TO_SHIP",
              "inTransit": "SHIPPED", "pendingService": "SHIPPED"}
STAGE = {"APPROVED": 1, "PACKED": 2, "READY_TO_DISPATCH": 3, "READY_TO_SHIP": 3, "SHIPPED": 4,
         "DELIVERED": 5, "RETURN_REQUESTED": 6, "RETURN_CANCELLED": 7, "RETURNED": 7, "UNDELIVERED": 7}
SHIPPED_STAGE, UNKNOWN_STAGE = 4, 5          # a status this table doesn't know counts as after delivery
SPELLING = {"IN_TRANSIT": "SHIPPED"}          # payments say IN_TRANSIT where the report says SHIPPED
DELIVERED_LIKE = {"DELIVERED", "RETURN_CANCELLED"}


class SyncRefused(Exception):
    """The data read belongs to another business — nothing was written."""


# ── values ───────────────────────────────────────────────────────────────────

def _num(v):
    if v in (None, "", "null"):
        return None
    try:
        return Decimal(str(v)).quantize(CENT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return None


def _day(v):
    """Seller Hub's dates: "Nov 13,2026", "26-Oct-2026", "2026-11-03T09:51:25", "2026-11-03", or epoch ms."""
    if v in (None, "", "null"):
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v / 1000, IST).date()
    text = str(v).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}", text):
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None
    if text.isdigit():
        return datetime.fromtimestamp(int(text) / 1000, IST).date()
    for fmt in ("%b %d,%Y", "%b %d, %Y", "%d-%b-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def stage(st):
    return STAGE.get(st or "", UNKNOWN_STAGE if st else 0)


def moves_on(current, new):
    """Whether Flipkart's status `new` should replace the row's `current` one."""
    if not new or new == current:
        return False
    if not current or current == "CANCELLED":       # listed live again: whatever cancelled it was wrong
        return new != "CANCELLED" or not current
    if new == "CANCELLED":
        return stage(current) < SHIPPED_STAGE
    return stage(new) >= stage(current)


# ── reads (all read-only) ────────────────────────────────────────────────────

def read_payouts(account, s, today):
    out, token = [], "0"
    for _ in range(TABLE_PAGES):
        d = fs.graphql(account, "Payments_Previous_Payments_WEB_getTableData",
                       {"start_date": (today - timedelta(days=PAYOUT_DAYS)).isoformat(), "end_date": today.isoformat(),
                        "token": token, "page_size": str(TABLE_PAGE), "neft_id": ""}, PAYOUTS_QUERY, s=s)
        t = d.get("payments_fetchPreviousPaymentTableData") or {}
        out += [r for r in t.get("data") or [] if isinstance(r, dict) and r.get("advice_id")]
        if not t.get("show_more") or str(t.get("token")) == token:
            break
        token = str(t.get("token"))
    return out


def read_transactions(account, s, start, end, payment_type, settled=True):
    """Payments > Transactions, order items (sales & returns): one dict per row, {key: value}."""
    rows, token = [], 0
    for _ in range(TABLE_PAGES):
        d = fs.graphql(account, "TransactionPage_getTransactionsTableData",
                       {"tabName": "orderItem", "subTabName": "sale,returns", "startDate": start.isoformat(),
                        "endDate": end.isoformat(), "token": token, "size": TABLE_PAGE, "filters": {},
                        "settlementStatus": "settled" if settled else "unsettled", "paymentType": payment_type},
                       TABLE_QUERY, s=s)
        t = d.get("getTransactionTableData") or {}
        rows += [{f.get("key"): f.get("value") for f in tr.get("fields") or []} for tr in t.get("transactions") or []]
        if not t.get("is_next") or t.get("token") in (None, token):
            break
        token = t.get("token")
    return [r for r in rows if r.get("order_item_id")]


def read_completed(account, s):
    """The Completed tab's shipments, with each order item's quantity (0 = cancelled)."""
    out = []
    for page in range(1, COMPLETED_PAGES + 1):
        d = fs.orchestrator(account, "GetShipmentListByOrderId", {"input": fs._list_input(account, "completed", page)},
                            fs.LIST_QUERY, s=s)
        f = d.get("filteredShipmentGroups") or {}
        for g in f.get("shipmentGroups") or []:
            for sh in g.get("shipments") or []:
                row = fs._row(sh, "completed")
                row["item_qty"] = {i.get("orderItemId"): i.get("quantity") for i in sh.get("shipmentOrderItems") or []
                                   if i.get("orderItemId")}
                out.append(row)
        if not (f.get("pageInfo") or {}).get("hasMore"):
            break
    return out


# ── orders → FlipkartOrder ───────────────────────────────────────────────────

def _shipment_status(row, item_id):
    if row["tab"] != "completed":
        return TAB_STATUS.get(row["tab"])
    if row.get("delivered_at"):
        return "DELIVERED"
    if row.get("item_qty", {}).get(item_id) == 0 and not row.get("dispatched_at"):
        return "CANCELLED"
    return "SHIPPED" if row.get("dispatched_at") else None


def order_items(shipments):
    """{order_item_id: (status, fields)} from Forward Orders shipments — a later one wins."""
    out = {}
    for row in shipments:
        ids, items = row.get("order_item_ids") or [], row.get("items") or []
        for n, item_id in enumerate(ids):
            it = items[n] if len(items) == len(ids) else (items[0] if items else {})
            qty = (row.get("item_qty") or {}).get(item_id)
            out[str(item_id)] = (_shipment_status(row, item_id), {
                "order_id": row.get("order_id") or "", "order_date": _day(row.get("created")),
                "order_approval_date": _day(row.get("accepted_at")), "sku": it.get("sku") or "", "fsn": it.get("fsn") or "",
                "product_title": (it.get("title") or "")[:500], "quantity": qty or it.get("qty") or 1,
                "logistics_partner": (row.get("courier") or "")[:100], "delivery_tracking_id": (row.get("tracking_id") or "")[:100],
                "dispatch_by_date": _day(row.get("dispatch_by")), "dispatched_date": _day(row.get("dispatched_at")),
                "delivery_date": _day(row.get("delivered_at")),
            })
    return out


def _blank(v):
    return v in (None, "")


def write_orders(business, items, now, res):
    """Bring FlipkartOrder up to date from {order_item_id: (status, fields)}."""
    ids = list(items)
    existing, untouched = {}, []
    for i in range(0, len(ids), 500):
        existing.update({o.order_item_id: o for o in FlipkartOrder.objects.filter(business=business, order_item_id__in=ids[i:i + 500])})
    for item_id, (st, fields) in items.items():
        st = SPELLING.get(st, st)
        o = existing.get(item_id)
        if o is None:
            FlipkartOrder.objects.create(business=business, order_item_id=item_id, order_item_status=st or "SHIPPED",
                                         synced_at=now, **{k: v for k, v in fields.items() if v is not None})
            res["orders_added"] += 1
            continue
        changed = []
        for k, v in fields.items():                      # an uploaded report's details stay; only gaps are filled
            if not _blank(v) and _blank(getattr(o, k)):
                setattr(o, k, v)
                changed.append(k)
        if moves_on(o.order_item_status, st):
            o.order_item_status = st
            changed.append("order_item_status")
            res["orders_status_changed"] += 1
        elif st and st != o.order_item_status:
            res["orders_kept_further_on"] += 1
        if not changed:
            untouched.append(o.pk)
            continue
        o.synced_at = now
        o.save(update_fields=[*changed, "synced_at", "updated_at"])
        res["orders_updated"] += 1
    for i in range(0, len(untouched), 1000):              # only confirmed: no row rewritten, no screen to redo
        FlipkartOrder.objects.filter(pk__in=untouched[i:i + 1000]).update(synced_at=now)


# ── payments → FlipkartPayout / FlipkartOrderPayment ─────────────────────────

_SUMS = {"sale_amount": "sale_amount", "total_offer_amount": "offer_amount", "my_share": "seller_share",
         "marketplace_fee": "flipkart_fees", "taxes": "taxes", "offer_adjustments": "offer_adjustments",
         "refund": "refund_amount", "settlement_value": "settlement_value"}


def group_items(rows):
    """Seller Hub lists an item once per line (Sale, Return, Promotions…); the tables keep one row per item per payout."""
    out = {}
    for r in rows:
        item_id = str(r["order_item_id"])
        g = out.setdefault(item_id, {"rows": [], **{k: None for k in _SUMS}})
        g["rows"].append(r)
        for field, key in _SUMS.items():
            v = _num(r.get(key))
            if v is not None:
                g[field] = (g[field] or ZERO) + v
    for item_id, g in out.items():
        rows_ = g.pop("rows")
        last = rows_[-1]
        descr = {(x.get("description") or "").strip() for x in rows_}
        g.update(order_id=last.get("order_id") or "", seller_sku=last.get("sku") or "",
                 order_date=_day(last.get("order_date")), dispatch_date=_day(last.get("dispatched_date")),
                 fulfilment_type=last.get("fulfillment_type") or None, settlement_value=g["settlement_value"] or ZERO,
                 order_status=SPELLING.get((last.get("order_status") or "").upper(), (last.get("order_status") or "").upper()),
                 returned=any("RETURN" in d.upper() for d in descr), lines=len(rows_))
    return out


def payout_fields(r, now):
    utr = (r.get("utr_number") or "").strip()
    # Until the bank has it, Seller Hub shows "DISBURSEMENT_CREATED" where the UTR goes.
    paid = (r.get("settlement_status") or "").lower() == "completed" and bool(utr) and not utr.upper().startswith("DISBURSEMENT")
    return {"utr": utr if paid else "", "payment_date": _day(r.get("payment_date")),
            "settlement_type": (r.get("settlement_type") or "").upper(),
            "status": FlipkartPayout.STATUS_PAID if paid else FlipkartPayout.STATUS_IN_PROGRESS,
            "flipkart_status": (r.get("settlement_status") or "")[:40], "transfer_amount": _num(r.get("transfer_amount")) or ZERO,
            "read_at": now}


def elsewhere(business, utrs, item_ids):
    """The other business these payments are already recorded under, if any."""
    from accounts.models import Business
    utrs = [u for u in utrs if u]
    ids = set()
    if utrs:
        ids |= set(FlipkartOrderPayment.objects.exclude(business=business).filter(neft_id__in=utrs).values_list("business_id", flat=True)[:5])
        ids |= set(FlipkartPayout.objects.exclude(business=business).filter(utr__in=utrs).values_list("business_id", flat=True)[:5])
    if not ids and item_ids:
        sample = list(item_ids)[:500]
        ids |= set(FlipkartOrderPayment.objects.exclude(business=business).filter(order_item_id__in=sample).values_list("business_id", flat=True)[:5])
    if not ids:
        return None
    return Business.objects.filter(pk__in=ids).order_by("name").first()


def write_payment_items(business, payout, grouped, now, res):
    existing = {p.order_item_id: p for p in FlipkartOrderPayment.objects.filter(business=business, neft_id=payout.utr,
                                                                                  order_item_id__in=list(grouped))}
    for item_id, g in grouped.items():
        p = existing.get(item_id)
        values = {k: g[k] for k in (*_SUMS, "order_id", "seller_sku", "order_date", "dispatch_date", "fulfilment_type")}
        if p is None:
            FlipkartOrderPayment.objects.create(
                business=business, order_item_id=item_id, neft_id=payout.utr, payment_date=payout.payment_date,
                return_type="Return" if g["returned"] else "NA", item_return_status="", synced_at=now,
                **{k: v for k, v in values.items() if v is not None or k in _SUMS})
            res["payments_added"] += 1
            continue
        changed = []
        for k, v in values.items():                       # an uploaded report's figures stay; only gaps are filled
            if v is not None and _blank(getattr(p, k)):
                setattr(p, k, v)
                changed.append(k)
        if p.payment_date is None:
            p.payment_date = payout.payment_date
            changed.append("payment_date")
        p.synced_at = now
        p.save(update_fields=[*changed, "synced_at", "updated_at"])
        res["payments_confirmed"] += 1


def _order_items_from_payments(grouped_list):
    """{order_item_id: (status, fields)} — what the payments say about orders (the newest read wins)."""
    out = {}
    for grouped in grouped_list:
        for item_id, g in grouped.items():
            out[item_id] = (g["order_status"] or None, {"order_id": g["order_id"], "order_date": g["order_date"],
                                                         "sku": g["seller_sku"], "dispatched_date": g["dispatch_date"],
                                                         "fulfilment_type": g["fulfilment_type"] or ""})
    return out


# ── the sync ─────────────────────────────────────────────────────────────────

COUNTERS = ("orders_added", "orders_status_changed", "orders_updated", "orders_kept_further_on", "payouts_added",
            "payouts_paid", "payouts_items_read", "payments_added", "payments_confirmed", "upcoming")


def sync(account, s=None, today=None):
    """Read Seller Hub's orders and payments and write them into the Flipkart tables. Returns what it wrote.
    Raises FlipkartError (a read failed) or SyncRefused (the data belongs to another business)."""
    s = s or fs._load(account, fs._http())
    business = account.business
    today = today or timezone.localdate()
    now = timezone.now()
    res = dict.fromkeys(COUNTERS, 0)

    # Read everything first: nothing is written from a half-read.
    payouts = read_payouts(account, s, today)
    known = {p.advice_id: p for p in FlipkartPayout.objects.filter(business=business)}
    to_read = []
    for r in payouts:
        f = payout_fields(r, now)
        p = known.get(str(r["advice_id"]))
        if f["status"] == FlipkartPayout.STATUS_PAID and f["payment_date"] and (p is None or p.items_read_at is None or not p.utr):
            to_read.append((str(r["advice_id"]), f))
    # Two transfers of the same kind on one day can't be told apart by Seller Hub's date filter: read once, keep on the first.
    items_by_advice, seen = {}, set()
    for advice, f in to_read:
        key = (f["payment_date"], f["settlement_type"])
        if key in seen:
            continue
        seen.add(key)
        items_by_advice[advice] = read_transactions(account, s, f["payment_date"], f["payment_date"], f["settlement_type"])
    upcoming = []
    for pt in PAYMENT_TYPES:
        upcoming += [(pt, r) for r in read_transactions(account, s, today, today + timedelta(days=UPCOMING_DAYS), pt, settled=False)]
    shipments = [row for tab in fs.ORDER_TABS for row in ((account.orders or {}).get("tabs") or {}).get(tab) or []]
    shipments = read_completed(account, s) + shipments           # the live tabs are newer: they win

    grouped = {advice: group_items(rows) for advice, rows in items_by_advice.items()}
    utrs = [payout_fields(r, now)["utr"] for r in payouts]
    item_ids = {i for g in grouped.values() for i in g} | {str(r["order_item_id"]) for _, r in upcoming}
    other = elsewhere(business, utrs, item_ids)
    if other:
        raise SyncRefused(f"These Flipkart payments are already recorded under {other.name} — this login is "
                          f"{other.name}'s Flipkart account. Disconnect it here and connect it on {other.name}; "
                          f"nothing was written to {business.name}.")

    with deferred_bumps(business.pk), transaction.atomic():
        for r in payouts:
            advice, f = str(r["advice_id"]), payout_fields(r, now)
            if not f["payment_date"]:
                continue
            p = known.get(advice)
            if p is None:
                p = FlipkartPayout.objects.create(business=business, advice_id=advice, **f)
                res["payouts_added"] += 1
            else:
                became_paid = p.status != f["status"] == FlipkartPayout.STATUS_PAID
                for k, v in f.items():
                    setattr(p, k, v)
                p.save()
                res["payouts_paid"] += 1 if became_paid else 0
            if advice in grouped:
                write_payment_items(business, p, grouped[advice], now, res)
                rows = items_by_advice[advice]
                p.items_count = len(grouped[advice])
                p.items_amount = sum((_num(x.get("settlement_value")) or ZERO for x in rows), ZERO)
                p.items_read_at = now
                p.save(update_fields=["items_count", "items_amount", "items_read_at", "updated_at"])
                res["payouts_items_read"] += 1

        write_orders(business, order_items(shipments), now, res)
        # Then what the payments say: their order status is Flipkart's latest (delivered, returned…).
        pay_orders = _order_items_from_payments(list(grouped.values()) + [group_items([r for _, r in upcoming])])
        write_orders(business, pay_orders, now, res)

        FlipkartOutstandingPayment.objects.filter(business=business).delete()
        FlipkartOutstandingPayment.objects.bulk_create([FlipkartOutstandingPayment(
            business=business, order_item_id=str(r["order_item_id"]), order_id=r.get("order_id") or "",
            sku=(r.get("sku") or "")[:200], settlement_type=pt, description=(r.get("description") or "")[:100],
            order_status=SPELLING.get((r.get("order_status") or "").upper(), (r.get("order_status") or "").upper())[:50],
            order_date=_day(r.get("order_date")), dispatch_date=_day(r.get("dispatched_date")), due_date=_day(r.get("due_date")),
            sale_amount=_num(r.get("sale_amount")), settlement_value=_num(r.get("settlement_value")) or ZERO,
            details=r, read_at=now) for pt, r in upcoming])
        res["upcoming"] = len(upcoming)
    return res


def run(account, s=None):
    """sync(), with its outcome kept on the account. Returns that outcome; a read error is kept and re-raised."""
    try:
        out = {"ok": True, **sync(account, s)}
    except SyncRefused as e:
        out = {"ok": False, "refused": True, "message": str(e)}
    except fs.FlipkartError as e:
        account.sync, account.sync_at = {"ok": False, "message": str(e)}, timezone.now()
        account.save(update_fields=["sync", "sync_at", "updated_at"])
        raise
    account.sync, account.sync_at = out, timezone.now()
    account.save(update_fields=["sync", "sync_at", "updated_at"])
    return out


# ── reconciliation ───────────────────────────────────────────────────────────

def _f(v):
    return float(v or 0)


def reconcile(business, days=60, today=None):
    today = today or timezone.localdate()
    since = today - timedelta(days=days)

    payouts = list(FlipkartPayout.objects.filter(business=business, payment_date__gte=since))
    utrs = [p.utr for p in payouts if p.utr]
    items, item_n = {}, {}
    for r in (FlipkartOrderPayment.objects.filter(business=business, neft_id__in=utrs).values("neft_id")
              .annotate(n=Count("id"), v=Sum("settlement_value")) if utrs else []):
        items[r["neft_id"]], item_n[r["neft_id"]] = r["v"], r["n"]
    other = dict(FlipkartOtherCharge.objects.filter(business=business, neft_id__in=utrs).values("neft_id")
                 .annotate(v=Sum("amount")).values_list("neft_id", "v")) if utrs else {}
    rows = []
    for p in payouts:
        items_v, other_v = items.get(p.utr), other.get(p.utr)
        diff = None if not p.utr or items_v is None else p.transfer_amount - items_v - (other_v or ZERO)
        state = ("in_progress" if p.status != FlipkartPayout.STATUS_PAID else
                 "not_read" if items_v is None else
                 "matched" if abs(diff) <= 1 else
                 "other_charges" if other_v is None else "mismatch")
        rows.append({"advice_id": p.advice_id, "utr": p.utr, "date": p.payment_date, "type": p.settlement_type,
                     "status": p.status, "transfer": _f(p.transfer_amount), "items": item_n.get(p.utr, 0),
                     "items_amount": _f(items_v), "other_charges": _f(other_v), "difference": None if diff is None else _f(diff),
                     "state": state, "seller_hub_items": p.items_count, "seller_hub_amount": None if p.items_amount is None else _f(p.items_amount)})

    orders = list(FlipkartOrder.objects.filter(business=business, order_date__gte=since)
                  .values("order_item_id", "order_id", "order_date", "order_item_status", "sku", "quantity",
                          "dispatched_date", "delivery_date", "synced_at"))
    ids = [o["order_item_id"] for o in orders]
    paid, coming = defaultdict(lambda: ZERO), defaultdict(lambda: ZERO)
    for i in range(0, len(ids), 1000):
        for item_id, v in FlipkartOrderPayment.objects.filter(business=business, order_item_id__in=ids[i:i + 1000]).values_list("order_item_id", "settlement_value"):
            paid[item_id] += v or ZERO
    due = {}
    for o in FlipkartOutstandingPayment.objects.filter(business=business):
        coming[o.order_item_id] += o.settlement_value or ZERO
        due[o.order_item_id] = min(filter(None, [due.get(o.order_item_id), o.due_date]), default=None)
    buckets = defaultdict(lambda: {"count": 0, "amount": 0.0})
    attention = []
    for o in orders:
        st, item_id = o["order_item_status"], o["order_item_id"]
        if item_id in paid:
            b = "paid"
        elif item_id in coming:
            b = "coming"
        elif st == "CANCELLED":
            b = "cancelled"
        elif st in DELIVERED_LIKE:
            b = "delivered_unpaid"
        elif stage(st) >= 6:
            b = "returned"
        else:
            b = "on_the_way"
        buckets[b]["count"] += 1
        buckets[b]["amount"] += _f(paid.get(item_id) if b == "paid" else coming.get(item_id))
        delivered = o["delivery_date"] or o["dispatched_date"]
        if b == "delivered_unpaid" and delivered and (today - delivered).days >= UNPAID_AFTER_DAYS:
            attention.append({**o, "days": (today - delivered).days})
    attention.sort(key=lambda o: -o["days"])
    paid_rows = [r for r in rows if r["status"] == FlipkartPayout.STATUS_PAID]
    return {
        "days": days, "since": since,
        "payouts": rows,
        "totals": {"transferred": sum(r["transfer"] for r in paid_rows),
                   "in_progress": sum(r["transfer"] for r in rows if r["status"] != FlipkartPayout.STATUS_PAID),
                   "matched": sum(1 for r in rows if r["state"] == "matched"),
                   "to_check": sum(1 for r in rows if r["state"] in ("mismatch", "other_charges", "not_read")),
                   "upcoming": sum(_f(v) for v in coming.values()),
                   "upcoming_items": len(coming)},
        "orders": {k: buckets[k] for k in ("paid", "coming", "on_the_way", "delivered_unpaid", "returned", "cancelled")},
        "orders_total": len(orders),
        "unpaid": attention[:200], "unpaid_count": len(attention),
        "upcoming_by_date": sorted(({"date": d, "amount": a} for d, a in _by_due(business).items()), key=lambda x: x["date"]),
    }


def _by_due(business):
    out = defaultdict(float)
    for d, v in FlipkartOutstandingPayment.objects.filter(business=business, due_date__isnull=False).values_list("due_date", "settlement_value"):
        out[d] += _f(v)
    return out


@api_view(["GET"])
def reconcile_view(request, business_id):
    """GET flipkart-seller/reconcile/?business=<id>&days=60 — one business (default: the one on screen)."""
    _, desk = fs._desk(request, business_id)
    wanted = request.GET.get("business")
    b = next((x for x in desk if str(x.pk) == str(wanted)), None) if wanted else desk[0]
    if b is None:
        return Response({"error": "You can't see Flipkart for that business."}, status=status.HTTP_403_FORBIDDEN)
    try:
        days = max(7, min(180, int(request.GET.get("days") or 60)))
    except ValueError:
        days = 60
    a = fs.A.objects.filter(business=b).first()
    out = reconcile(b, days)
    out.update(business=b.pk, business_name=b.name, sync=getattr(a, "sync", None) or {}, sync_at=getattr(a, "sync_at", None))
    return Response(out)
