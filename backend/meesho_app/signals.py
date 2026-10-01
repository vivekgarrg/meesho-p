"""
Connects ParentItemPrice / FinalPrice / MasterItem / MasterItemComponent
writes to pricing_sync (cross-business mirroring) and master_pricing
(bill-of-materials price cascade) — see those modules' docstrings for the
full picture. Registered from apps.py's ready().
"""

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from . import master_pricing, pricing_sync
from .models import FinalPrice, MasterItem, MasterItemComponent, ParentItemPrice


@receiver(pre_save, sender=ParentItemPrice)
def _parent_item_price_pre_save(sender, instance, **kwargs):
    # Stashed so post_save can tell a rename (item_id changed) apart from an
    # ordinary price edit — a rename needs the sibling's existing row renamed
    # in place, not a fresh duplicate created under the new name.
    if instance.pk:
        old = ParentItemPrice.objects.filter(pk=instance.pk).values_list("item_id", flat=True).first()
        instance._pricing_sync_old_item_id = old
    else:
        instance._pricing_sync_old_item_id = None


@receiver(post_save, sender=ParentItemPrice)
def _parent_item_price_saved(sender, instance, created, **kwargs):
    old_item_id = getattr(instance, "_pricing_sync_old_item_id", None)
    if not created and old_item_id and old_item_id != instance.item_id:
        pricing_sync.sync_parent_renamed(instance.business, old_item_id, instance.item_id)
    pricing_sync.sync_parent_saved(instance)


@receiver(post_delete, sender=ParentItemPrice)
def _parent_item_price_deleted(sender, instance, **kwargs):
    pricing_sync.sync_parent_deleted(instance.business, instance.item_id)


@receiver(post_save, sender=FinalPrice)
def _final_price_saved(sender, instance, **kwargs):
    pricing_sync.sync_final_saved(instance)


@receiver(post_delete, sender=FinalPrice)
def _final_price_deleted(sender, instance, **kwargs):
    pricing_sync.sync_final_deleted(instance.business, instance.sku_id)


@receiver(pre_save, sender=MasterItem)
def _master_item_pre_save(sender, instance, **kwargs):
    if instance.pk:
        old = MasterItem.objects.filter(pk=instance.pk).values_list("name", flat=True).first()
        instance._pricing_sync_old_name = old
    else:
        instance._pricing_sync_old_name = None


@receiver(post_save, sender=MasterItem)
def _master_item_saved(sender, instance, created, **kwargs):
    old_name = getattr(instance, "_pricing_sync_old_name", None)
    if not created and old_name and old_name != instance.name:
        pricing_sync.sync_master_item_renamed(instance.business, old_name, instance.name)
    pricing_sync.sync_master_item_saved(instance)
    # A price change here is exactly what every parent built from this
    # master item needs reflected — see master_pricing's module docstring.
    master_pricing.reprice_parents_using(instance)


@receiver(post_delete, sender=MasterItem)
def _master_item_deleted(sender, instance, **kwargs):
    pricing_sync.sync_master_item_deleted(instance.business, instance.name)


@receiver(post_save, sender=MasterItemComponent)
def _master_item_component_saved(sender, instance, **kwargs):
    pricing_sync.sync_component_saved(instance)
    master_pricing.reprice_parent(instance.parent)


@receiver(post_delete, sender=MasterItemComponent)
def _master_item_component_deleted(sender, instance, **kwargs):
    pricing_sync.sync_component_deleted(instance.parent.business, instance.parent.item_id, instance.master_item.name)
    master_pricing.reprice_parent(instance.parent)
