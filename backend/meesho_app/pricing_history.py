"""
Every change to a parent SKU's price is dated, however it was made.

Profit costs each order at the price in effect on the ORDER's date (see
views._history_entry_at). That only works if price changes leave a dated
record. "Add Price Entry" always did; nothing else did — Edit Price, the Excel
upload, a master-list price cascading into a recipe, a linked business's
pricing sync. Those just overwrote the current price, and since an order with
no dated entry falls back to the current price, raising a price that way
quietly recosted every past order at the new price.

So a change made by any of those paths now writes:

  - a baseline entry with the OLD price, dated from the business's earliest
    order — only the first time a parent's price changes, when nothing dated
    exists yet — so orders already placed keep the price they were sold at;
  - an entry with the NEW price, dated today, so orders from today on use it.

Hooked in from signals.py (pre_save remembers the old price, post_save
records the change) so every .save() path is covered without each call site
having to remember to. "Add Price Entry" writes its own dated entry and only
needs ensure_baseline() first.
"""

from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db.models import Min
from django.utils import timezone

PRICE_FIELDS = ("item_price", "tax_percent", "packaging_cost", "final_price")


def _norm(value):
    """Comparable form of a price field: the database hands back
    Decimal("40.00") while a save in progress may hold "40" or 40, and those
    must count as the same price or every save would look like a change."""
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value)).normalize()
    except (InvalidOperation, ValueError):
        return value


def price_snapshot(parent):
    return tuple(getattr(parent, f) for f in PRICE_FIELDS)


def same_price(a, b):
    return a is not None and b is not None and tuple(map(_norm, a)) == tuple(map(_norm, b))


def _earliest_order_date(business):
    """The first day this business has any order on record — the baseline's
    date, so it covers every order already placed. None if there are none."""
    from .models import Order, OrderPayment

    found = []
    first_payment = (OrderPayment.objects.filter(business=business, order_date__isnull=False)
                     .aggregate(d=Min("order_date"))["d"])
    if first_payment:
        found.append(first_payment.date() if hasattr(first_payment, "date") else first_payment)
    first_order = (Order.objects.filter(business=business, order_date__isnull=False)
                   .aggregate(d=Min("order_date"))["d"])
    if first_order:
        found.append(first_order.date() if hasattr(first_order, "date") else first_order)
    return min(found) if found else None


def _final_price(item_price, tax_percent, packaging_cost):
    from .master_pricing import compute_final_price
    return compute_final_price(item_price, tax_percent, packaging_cost)


def ensure_baseline(parent, old, before):
    """Record `old` (a price_snapshot) as the price in effect before `before`
    — but only if this parent has no dated history yet. Once anything is
    dated, the history already speaks for the past and must not be second-
    guessed. Returns the entry it created, or None."""
    from .models import ParentPriceHistory

    item_price, tax_percent, packaging_cost, final_price = old
    if item_price is None or ParentPriceHistory.objects.filter(parent=parent).exists():
        return None
    earliest = _earliest_order_date(parent.business)
    day_before = before - timedelta(days=1)
    effective = min(earliest, day_before) if earliest else day_before
    return ParentPriceHistory.objects.create(
        parent=parent,
        business=parent.business,
        effective_from=effective,
        item_price=item_price,
        tax_percent=tax_percent or 0,
        packaging_cost=packaging_cost or 0,
        final_price=final_price if final_price is not None
        else _final_price(item_price, tax_percent, packaging_cost),
        notes="Price before the first recorded change (recorded automatically)",
    )


def record_change(parent, old, on=None):
    """A parent's price just changed from `old` to what it holds now: keep
    the old price for earlier orders (first time only) and date the new one
    from `on` (today by default). Same-day changes replace that day's entry
    rather than stacking. No-op if nothing actually changed, or if the new
    price is not a complete one."""
    from .models import ParentPriceHistory

    new = price_snapshot(parent)
    if same_price(old, new) or parent.item_price is None:
        return None

    # Item price, tax or packaging moved but final_price didn't: it's stale
    # (a save that sent the parts but not the total). Final price is always
    # item + tax + packaging everywhere else, so put the right one back —
    # recording the stale total would cost new orders at the old price.
    parts_changed = not same_price(old[:3], new[:3])
    final_unchanged = _norm(old[3]) == _norm(parent.final_price)
    if parent.final_price is None or (parts_changed and final_unchanged):
        from .models import ParentItemPrice
        parent.final_price = _final_price(parent.item_price, parent.tax_percent, parent.packaging_cost)
        # A queryset update, not .save(): this runs inside post_save, and a
        # save here would fire the signal again.
        ParentItemPrice.objects.filter(pk=parent.pk).update(final_price=parent.final_price)

    on = on or timezone.localdate()
    ensure_baseline(parent, old, on)
    entry, _created = ParentPriceHistory.objects.update_or_create(
        parent=parent,
        effective_from=on,
        defaults={
            "business": parent.business,
            "item_price": parent.item_price,
            "tax_percent": parent.tax_percent or 0,
            "packaging_cost": parent.packaging_cost or 0,
            "final_price": parent.final_price if parent.final_price is not None
            else _final_price(parent.item_price, parent.tax_percent, parent.packaging_cost),
            "notes": f"Price changed on {on:%d %b %Y} (recorded automatically)",
        },
    )
    return entry
