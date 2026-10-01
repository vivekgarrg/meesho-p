"""
Bill-of-materials pricing: a parent SKU can be built from one or more
MasterItem rows via MasterItemComponent ("2x Katori + 1x Plate"). Whenever a
parent has any components, its item_price IS the sum of
quantity * master_item.unit_price across them — raising "Katori" from ₹30 to
₹35 recomputes every parent built from it, and every FinalPrice child under
each of those, automatically. If the business is itself linked to others via
pricing_sync, each recomputed parent price mirrors across to them too.

Deliberately not chainable: a MasterItem can't be built from other
MasterItems, and a ParentItemPrice can never be used as a MasterItem — the
dependency only ever flows MasterItem -> ParentItemPrice -> FinalPrice, so
there is no cycle to guard against here, unlike a self-referential design
would need.

Wired from three signals (see signals.py): MasterItem.post_save (a price
changed -- recompute every parent using it), and
MasterItemComponent.post_save / post_delete (a parent's recipe changed --
recompute just that parent). A parent with no components is a complete
no-op here, same as pricing_sync's "no pricing_group = no-op" gate.
"""

from decimal import Decimal


def compute_final_price(item_price, tax_percent, packaging_cost):
    item_price = item_price or Decimal("0")
    tax_percent = tax_percent or 0
    packaging_cost = packaging_cost or Decimal("0")
    tax = Decimal(str(tax_percent)) / Decimal("100")
    return (item_price + item_price * tax + packaging_cost).quantize(Decimal("0.01"))


def compute_parent_item_price(parent):
    """Sum of quantity * master_item.unit_price across every component of
    `parent`, or None if it has no components at all (nothing to compute —
    leave whatever item_price is already there alone). An unpriced
    component (unit_price not set yet) contributes 0, not an error — the
    parent's price is just incomplete until every component has one."""
    total = Decimal("0")
    has_any = False
    for comp in parent.master_components.select_related("master_item").all():
        has_any = True
        total += comp.quantity * (comp.master_item.unit_price or Decimal("0"))
    return total if has_any else None


def reprice_parent(parent):
    """Recompute `parent`'s item_price/final_price from its components (if
    it has any) and save if that changed anything — covers both "a
    component's master item got a new price" and "the recipe itself
    changed" (added/removed/requantified a line)."""
    new_item_price = compute_parent_item_price(parent)
    if new_item_price is None:
        return False
    new_final_price = compute_final_price(new_item_price, parent.tax_percent, parent.packaging_cost)
    if parent.item_price == new_item_price and parent.final_price == new_final_price:
        return False
    parent.item_price = new_item_price
    parent.final_price = new_final_price
    parent.save(update_fields=["item_price", "final_price"])
    _push_children_and_mirror(parent)
    return True


def reprice_parents_using(master_item):
    """A MasterItem's price just changed — recompute every parent built
    from it, in this same business."""
    from .models import ParentItemPrice

    parents = ParentItemPrice.objects.filter(master_components__master_item=master_item).distinct()
    for parent in parents:
        reprice_parent(parent)


def _push_children_and_mirror(parent):
    """A parent's current price just changed outside the normal request-body
    save path — push it to that parent's own FinalPrice children (same rule
    linking a SKU, or adding a price-history entry, already follows) via a
    bulk update, then tell pricing_sync explicitly since a bulk update never
    fires the signal that would otherwise mirror it cross-business."""
    from . import pricing_sync
    from .models import FinalPrice

    FinalPrice.objects.filter(business=parent.business, parent=parent).update(
        item_price=parent.item_price,
        tax_percent=parent.tax_percent,
        packaging_cost=parent.packaging_cost,
        final_price=parent.final_price,
    )
    pricing_sync.sync_parent_and_children(parent.business, parent.item_id)


def resolve_master_item(name, business):
    """Resolve a master item name to the business-scoped MasterItem (or
    None, with an error message, if it doesn't exist)."""
    if not name:
        return None, "Master item name is required."
    from .models import MasterItem

    item = MasterItem.objects.filter(business=business, name__iexact=name).first()
    if not item:
        return None, f"No master item named \"{name}\" in this business."
    return item, None
