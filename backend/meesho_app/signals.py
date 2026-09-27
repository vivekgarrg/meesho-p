"""
Connects ParentItemPrice / FinalPrice writes to pricing_sync — see that
module's docstring for the full picture. Registered from apps.py's ready().
"""

from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from . import pricing_sync
from .models import FinalPrice, ParentItemPrice


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
