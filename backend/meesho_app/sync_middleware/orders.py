"""
Orders middleware: the Meesho panel's order tabs (as the sync worker last read
them — snapshots orders_<tab>, rows already trimmed by PanelOrders.normalize)
→ the orders table (Order), the way an Orders CSV upload keeps it:

  · an order not in the table yet is added, with its status, date and details;
  · one already there gets its details (SKU, size, quantity, product, packet
    id) refreshed, and — when its status moved on — a row for the new status
    (one row per order per status, as the CSV writes them);
  · a status never goes backwards: a DELIVERED / RTO… / RETURN… order (from a
    CSV) isn't put back to SHIPPED, nor SHIPPED back to READY_TO_SHIP. The one
    exception is CANCELLED — an order the panel lists live again wasn't.

Rows without a sub-order number or with an unknown tab are rejected.

After shipping, an order leaves the panel's lists (they have no Delivered tab).
settle() then takes its outcome from what Meesho says elsewhere — its returns
(the returns table) first, then the order status on its payments — mapped to
the statuses an Orders sheet writes. With neither, it stays SHIPPED: nothing is
guessed.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from ..meesho_images import meesho_image
from ..models import MeeshoSyncSnapshot, Order, OrderPayment, ReturnDelivery
from .base import Result, deferred_bumps, missing

IST = ZoneInfo("Asia/Kolkata")
TABS = ("hold", "pending", "ready_to_ship", "shipped", "cancelled")     # snapshot order: later wins
STATUS = {"hold": "HOLD", "pending": "PENDING", "ready-to-ship": "READY_TO_SHIP", "shipped": "SHIPPED", "cancelled": "CANCELLED"}
STAGE = {"HOLD": 1, "PENDING": 1, "READY_TO_SHIP": 2, "SHIPPED": 3}
AFTER_SHIPPING = 4                     # DELIVERED, RTO…, RETURN… — anything the panel's tabs don't show
SOURCE = "Meesho panel sync"
DETAILS = {"sku": "sku", "size": "variation", "quantity": "quantity", "product_name": "product_name", "packet_id": "packet_id",
           "meesho_image_url": "image"}


def stage(status):
    return STAGE.get(status or "", AFTER_SHIPPING if status else 0)


def moves_on(current, panel):
    """Whether the panel's status should replace the order's current one."""
    if not current or current == "CANCELLED":     # listed live again: whatever cancelled it was wrong
        return True
    if panel == "CANCELLED":
        return stage(current) < AFTER_SHIPPING
    return stage(panel) >= stage(current)


def order_date(row):
    """The order's date in India, from the panel's created_iso ("2026-10-30T18:00:15+0530")."""
    raw = str(row.get("created_iso") or "")
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%dT%H:%M:%S%z").astimezone(IST).date()
    except ValueError:
        try:
            return datetime.fromisoformat(raw).astimezone(IST).date()
        except ValueError:
            return None


def details_of(row):
    out = {}
    for field, key in DETAILS.items():
        v = row.get(key)
        if field == "meesho_image_url":
            v = meesho_image(v)                  # only a real Meesho product image is kept
        if v not in (None, ""):
            out[field] = int(v) if field == "quantity" and str(v).isdigit() else v
    return out


def rows_of(account):
    """The account's last-read order rows, every tab, in TABS order."""
    snaps = {s.endpoint: s for s in MeeshoSyncSnapshot.objects.filter(account=account, endpoint__in=[f"orders_{t}" for t in TABS])}
    rows = []
    for t in TABS:
        s = snaps.get(f"orders_{t}")
        rows += [r for r in (s.payload if s and isinstance(s.payload, list) else []) if isinstance(r, dict)]
    return rows


def inject(business, rows):
    """Bring the orders table up to date from these panel rows. Returns a Result."""
    res = Result()
    by_sub = {}
    for r in rows:
        lacking = missing(r, "sub_order_num", "tab")
        if lacking:
            res.reject(f"missing {', '.join(lacking)}", r)
            continue
        if r["tab"] not in STATUS:
            res.reject(f"unknown tab {r['tab']}", r)
            continue
        by_sub[r["sub_order_num"]] = r                     # a later tab wins, as the panel moves it on
    for k in ("added", "status_changed", "updated", "kept_further_on", "no_date"):
        res.add(k, 0)
    if not by_sub:
        return res

    existing = {}
    subs = list(by_sub)
    for i in range(0, len(subs), 500):
        for o in Order.objects.filter(business=business, sub_order_no__in=subs[i:i + 500]):
            existing.setdefault(o.sub_order_no, []).append(o)
    now = timezone.now()
    with deferred_bumps(business.pk), transaction.atomic():
        for sub, row in by_sub.items():
            status = STATUS[row["tab"]]
            details = details_of(row)
            have = existing.get(sub, [])
            if not have:
                day = order_date(row)
                if day is None:
                    res.add("no_date")
                Order.objects.create(business=business, sub_order_no=sub, reason_for_credit_entry=status,
                                     order_date=day, order_source=SOURCE, **details)
                res.add("added")
                continue
            stale = [o for o in have if any(str(getattr(o, f)) != str(v) for f, v in details.items())]
            if stale:
                Order.objects.filter(pk__in=[o.pk for o in stale]).update(**details, updated_at=now)
                res.add("updated")
            # The order's current status is its latest row — as Order.latest_per_order picks it.
            latest = max(have, key=lambda o: (o.order_date or datetime(1970, 1, 1).date(),
                                              o.created_at or datetime(1970, 1, 1, tzinfo=IST), o.id))
            if latest.reason_for_credit_entry == status:
                continue
            if not moves_on(latest.reason_for_credit_entry, status):
                res.add("kept_further_on")
                continue
            day = latest.order_date or order_date(row)
            back = next((o for o in have if o.reason_for_credit_entry == status and o.order_date == day), None)
            if back:
                # Back to a status it had on that date (one row per status and
                # date): that row becomes the latest again.
                Order.objects.filter(pk=back.pk).update(created_at=now, updated_at=now)
            else:
                Order.objects.create(business=business, sub_order_no=sub, reason_for_credit_entry=status, order_date=day,
                                     order_source=latest.order_source, catalog_id=latest.catalog_id,
                                     customer_state=latest.customer_state, **details)
            res.add("status_changed")
    return res


# The order status on Meesho's payments → the Orders sheet's, as the two agree
# on orders both have (Return: the order was delivered, then sent back).
PAYMENT_OUTCOME = {"delivered": "DELIVERED", "return": "DELIVERED", "rto": "RTO_COMPLETE", "exchange": "DOOR_STEP_EXCHANGED"}
# A courier return (RTO) by its stage in the returns table → the Orders sheet's.
RTO_OUTCOME = {ReturnDelivery.STAGE_IN_TRANSIT: "RTO_INITIATED", ReturnDelivery.STAGE_DELIVERED: "RTO_COMPLETE",
               ReturnDelivery.STAGE_LOST: "LOST", ReturnDelivery.STAGE_DISPOSED: "DISPOSED"}


def _is_rto(ret):
    return "rto" in f"{ret.type_of_return} {ret.sub_type}".lower()


def outcomes(business, subs):
    """{sub-order: (status, from)} for these sub-orders, from Meesho's returns, else its payments."""
    out = {}
    subs = list(subs)
    for i in range(0, len(subs), 500):
        chunk = subs[i:i + 500]
        for p in (OrderPayment.objects.filter(business=business, sub_order_no__in=chunk)
                  .exclude(live_order_status__isnull=True).order_by("payment_date", "id")
                  .only("sub_order_no", "live_order_status")):
            st = PAYMENT_OUTCOME.get(str(p.live_order_status or "").strip().lower())
            if st:
                out[p.sub_order_no] = (st, "payments")          # the latest payment's wins
        for r in ReturnDelivery.objects.filter(business=business, suborder_no__in=chunk).order_by("id"):
            st = RTO_OUTCOME.get(r.stage) if _is_rto(r) else "DELIVERED"   # a customer return: it was delivered
            if st:
                out[r.suborder_no] = (st, "returns")
    return out


def settle(business, live):
    """
    Orders whose current status is SHIPPED but that the panel no longer lists
    (`live`: every sub-order on its lists now) — moved on to what Meesho's
    returns or payments say happened. Returns a Result.
    """
    res = Result()
    for k in ("settled", "settled_from_returns", "settled_from_payments", "still_shipped"):
        res.add(k, 0)
    shipped = [o for o in Order.latest_per_order(Order.objects.filter(business=business, reason_for_credit_entry="SHIPPED"))
               if o.sub_order_no not in live]
    if not shipped:
        return res
    known = outcomes(business, [o.sub_order_no for o in shipped])
    have = {}
    for o in Order.objects.filter(business=business, sub_order_no__in=[o.sub_order_no for o in shipped if o.sub_order_no in known]):
        have.setdefault(o.sub_order_no, []).append(o)
    now = timezone.now()
    with deferred_bumps(business.pk), transaction.atomic():
        for latest in shipped:
            hit = known.get(latest.sub_order_no)
            if not hit:
                res.add("still_shipped")
                continue
            status, source = hit
            back = next((o for o in have.get(latest.sub_order_no, [])
                         if o.reason_for_credit_entry == status and o.order_date == latest.order_date), None)
            if back:
                Order.objects.filter(pk=back.pk).update(created_at=now, updated_at=now)
            else:
                Order.objects.create(business=business, sub_order_no=latest.sub_order_no, reason_for_credit_entry=status,
                                     order_date=latest.order_date, order_source=SOURCE, catalog_id=latest.catalog_id,
                                     customer_state=latest.customer_state, product_name=latest.product_name, sku=latest.sku,
                                     size=latest.size, quantity=latest.quantity, packet_id=latest.packet_id,
                                     meesho_image_url=latest.meesho_image_url)
            res.add("settled")
            res.add(f"settled_from_{source}")
    return res


def settle_account(account):
    """settle() for one account, against the panel lists it last read. Returns a Result."""
    return settle(account.business, {r["sub_order_num"] for r in rows_of(account) if r.get("sub_order_num")})
