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
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone

from ..models import MeeshoSyncSnapshot, Order
from .base import Result, deferred_bumps, missing

IST = ZoneInfo("Asia/Kolkata")
TABS = ("hold", "pending", "ready_to_ship", "shipped", "cancelled")     # snapshot order: later wins
STATUS = {"hold": "HOLD", "pending": "PENDING", "ready-to-ship": "READY_TO_SHIP", "shipped": "SHIPPED", "cancelled": "CANCELLED"}
STAGE = {"HOLD": 1, "PENDING": 1, "READY_TO_SHIP": 2, "SHIPPED": 3}
AFTER_SHIPPING = 4                     # DELIVERED, RTO…, RETURN… — anything the panel's tabs don't show
SOURCE = "Meesho panel sync"
DETAILS = {"sku": "sku", "size": "variation", "quantity": "quantity", "product_name": "product_name", "packet_id": "packet_id"}


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
