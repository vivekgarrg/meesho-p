"""
Keeps ParentItemPrice / FinalPrice rows in sync across businesses that share
a PricingGroup (accounts.models.Business.pricing_group) — see that model's
docstring for what "shared pricing" means and doesn't mean.

Wired in two ways:
  1. Django signals (post_save / post_delete on ParentItemPrice and
     FinalPrice — see signals.py) cover every ordinary .save() / .create() /
     .delete() / update_or_create() call anywhere in the app, present or
     future, without each call site needing to know sync exists. That's
     nearly everything: the Pricing tab, the CSV/workbook bulk importers, and
     the Team Tasks "create parent from SKU" flow all go through .save().
  2. A couple of call sites update current-price fields with a bulk
     QuerySet.update() — which Django deliberately never sends signals for,
     since it can affect many rows without loading them. Those call
     sync_parent_and_children() directly after the bulk update; see
     _sync_parent_current_price and parent_linking_to_sku in views.py.

A business with no pricing_group is a complete no-op through this whole
module — sync only ever activates for businesses someone has deliberately
linked (see the link_business_pricing management command).
"""

import threading

_local = threading.local()


def _is_syncing():
    return getattr(_local, "active", False)


class _SyncGuard:
    """Marks a mirrored write as already-syncing so it can't re-trigger
    another round of propagation — thread-local, so it's safe with a
    multi-threaded app server handling other requests concurrently."""

    def __enter__(self):
        self._was_active = _is_syncing()
        _local.active = True
        return self

    def __exit__(self, *exc):
        _local.active = self._was_active


def linked_businesses(business):
    """Other active businesses sharing this one's pricing group, or [] if it
    isn't in one. The gate every function below checks first."""
    if not business.pricing_group_id:
        return []
    from accounts.models import Business

    return list(
        Business.objects.filter(pricing_group_id=business.pricing_group_id, is_active=True).exclude(
            pk=business.pk
        )
    )


_PARENT_SYNCED_FIELDS = ("item_price", "tax_percent", "packaging_cost", "final_price", "image_url")
_FINAL_SYNCED_FIELDS = ("item_price", "tax_percent", "packaging_cost", "final_price", "parent_opt_out")


def sync_parent_saved(parent):
    """A ParentItemPrice was created or updated — mirror its price fields to
    every linked business, matched (and created if missing) by item_id."""
    if _is_syncing():
        return
    siblings = linked_businesses(parent.business)
    if not siblings:
        return
    from .models import ParentItemPrice

    with _SyncGuard():
        for biz in siblings:
            sibling, _created = ParentItemPrice.objects.get_or_create(business=biz, item_id=parent.item_id)
            changed = False
            for field in _PARENT_SYNCED_FIELDS:
                val = getattr(parent, field)
                if getattr(sibling, field) != val:
                    setattr(sibling, field, val)
                    changed = True
            if changed:
                sibling.save()


def sync_parent_renamed(business, old_item_id, new_item_id):
    """The parent kept its identity, only item_id changed — rename the
    sibling's matching row instead of leaving a stale duplicate behind."""
    if _is_syncing():
        return
    siblings = linked_businesses(business)
    if not siblings:
        return
    from .models import ParentItemPrice

    with _SyncGuard():
        for biz in siblings:
            ParentItemPrice.objects.filter(business=biz, item_id=old_item_id).update(item_id=new_item_id)


def sync_parent_deleted(business, item_id):
    """A ParentItemPrice was deleted — remove the matching row in every
    linked business too, so the two catalogues don't drift apart.

    Never raises: if a sibling's row is PROTECTed by its own Product listing,
    it's left in place (a pricing-sync feature has no business silently
    deleting someone's real catalogue/inventory data) — the same thing that
    would happen if that business's own user tried to delete it by hand.
    """
    if _is_syncing():
        return
    siblings = linked_businesses(business)
    if not siblings:
        return
    from django.db.models.deletion import ProtectedError

    from .models import ParentItemPrice

    with _SyncGuard():
        for biz in siblings:
            try:
                ParentItemPrice.objects.filter(business=biz, item_id=item_id).delete()
            except ProtectedError:
                pass


def sync_final_saved(final):
    """A FinalPrice (child SKU) was created or updated — mirror its price
    fields and its parent link (matched by the parent's item_id, since raw
    FK ids differ per business)."""
    if _is_syncing():
        return
    siblings = linked_businesses(final.business)
    if not siblings:
        return
    from .models import FinalPrice, ParentItemPrice

    parent_item_id = final.parent.item_id if final.parent_id else None

    with _SyncGuard():
        for biz in siblings:
            sibling, _created = FinalPrice.objects.get_or_create(business=biz, sku_id=final.sku_id)
            changed = False
            for field in _FINAL_SYNCED_FIELDS:
                val = getattr(final, field)
                if getattr(sibling, field) != val:
                    setattr(sibling, field, val)
                    changed = True
            target_parent = (
                ParentItemPrice.objects.filter(business=biz, item_id=parent_item_id).first()
                if parent_item_id
                else None
            )
            target_parent_id = target_parent.id if target_parent else None
            if sibling.parent_id != target_parent_id:
                sibling.parent = target_parent
                changed = True
            if changed:
                sibling.save()


def sync_final_deleted(business, sku_id):
    if _is_syncing():
        return
    siblings = linked_businesses(business)
    if not siblings:
        return
    from .models import FinalPrice

    with _SyncGuard():
        for biz in siblings:
            FinalPrice.objects.filter(business=biz, sku_id=sku_id).delete()


def sync_parent_and_children(business, item_id):
    """Re-reads `business`'s own parent + children for `item_id` and
    propagates their current values. For the two call sites that write
    current-price fields via a bulk QuerySet.update() — Django deliberately
    never sends post_save for those, so they call this explicitly right
    after, instead of relying on the signal.
    """
    if _is_syncing():
        return
    from .models import FinalPrice, ParentItemPrice

    parent = ParentItemPrice.objects.filter(business=business, item_id=item_id).first()
    if not parent:
        return
    sync_parent_saved(parent)
    for fp in FinalPrice.objects.filter(business=business, parent__item_id=item_id):
        sync_final_saved(fp)
