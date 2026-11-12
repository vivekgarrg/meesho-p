"""
SKU Pricing → Merge two parents of the same product into one.

"Kadai-Big" and "kadai big" were made for one product: every SKU of the one
being merged (the *source*) moves under the one kept (the *target*), and so
does everything else that pointed at the source — stock movements, packing,
tasks, listing photos and prices, pauses, Return Guard alerts, the product
page. The source is then removed. Nothing is lost:

  * SKUs                take the target's price, exactly as linking a SKU to a
                        parent does (views._bulk_link_skus_to_parent).
  * Price history       the target's is kept; the source's moves over only when
                        the target has none (two price lines for one product
                        would contradict each other).
  * Bill of materials   the same rule.
  * Listing prices      one per marketplace: the target's wins where both have one.
  * Pause               if either was paused, the target stays / becomes paused.
  * Product page        moved when only the source has one; both having one is
                        the one thing that stops a merge (pick one first).
  * Photo               the source's, when the target has none.
  * Stock               purchases, adjustments and packing all move, so the
                        target's stock is the two added together.

Businesses sharing pricing (pricing_sync) have the same parents mirrored:
the merge is made in each of them too, in one transaction, with the mirror
held off — otherwise deleting the source would delete it in every sibling and
leave their SKUs without a parent.
"""

from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import api_cache, pricing_sync
from .models import (FinalPrice, InventoryAdjustment, InventoryLog, ListingHubLink, ListingHubPause, ListingImage,
                     ListingPrice, MasterItemComponent, PackedStockEvent, ParentItemPrice, ParentPriceHistory, Product,
                     PurchaseItem, ReturnGuardAlert, WorkerTask)

PRICE_FIELDS = ("item_price", "tax_percent", "packaging_cost", "final_price", "buffer_amount")
# Relations simply moved to the target.
MOVED = ((PurchaseItem, "parent_sku"), (InventoryAdjustment, "parent_sku"), (PackedStockEvent, "parent_sku"),
         (WorkerTask, "parent_sku"), (ListingImage, "parent"), (ListingHubLink, "parent"), (ReturnGuardAlert, "parent"))
# Every relation to a parent this module knows how to carry over. A new one added to the models
# stops merges (with a clear error) until it's handled here — never silently cascaded away.
HANDLED = {(m, f) for m, f in MOVED} | {(FinalPrice, "parent"), (MasterItemComponent, "parent"),
                                        (ParentPriceHistory, "parent"), (ListingPrice, "parent"),
                                        (ListingHubPause, "parent"), (Product, "parent_sku")}


class MergeRefused(Exception):
    def __init__(self, message, http=status.HTTP_400_BAD_REQUEST):
        super().__init__(message)
        self.http = http


def _relations():
    return [(r.related_model, r.field.name) for r in ParentItemPrice._meta.related_objects]


def _unhandled():
    return [f"{m.__name__}.{f}" for m, f in _relations() if (m, f) not in HANDLED]


def _product(parent):
    return Product.objects.filter(parent_sku=parent).first()


def _check(source, target):
    if source.pk == target.pk:
        raise MergeRefused("Pick two different parents.")
    if source.business_id != target.business_id:
        raise MergeRefused("Both parents must be in the same business.")
    left = _unhandled()
    if left:
        raise MergeRefused(f"Merging can't carry over {', '.join(left)} yet — nothing was changed.",
                           status.HTTP_409_CONFLICT)
    if _product(source) and _product(target):
        raise MergeRefused(f"Both {source.item_id} and {target.item_id} have a product page (Products). "
                           f"Remove one of them first, then merge.", status.HTTP_409_CONFLICT)


def _pairs(business, source_id, target_id):
    """[(source, target-or-None, business)] — this business first, then each pricing-linked one that has the source."""
    out = []
    for biz in [business, *pricing_sync.linked_businesses(business)]:
        src = ParentItemPrice.objects.filter(business=biz, item_id=source_id).first()
        dst = ParentItemPrice.objects.filter(business=biz, item_id=target_id).first()
        if biz.pk == business.pk:
            if not src or not dst:
                raise MergeRefused("No such parent.", status.HTTP_404_NOT_FOUND)
        elif not src:
            continue
        out.append((src, dst, biz))
    return out


def preview(business, source_id, target_id):
    """What a merge would do, without doing it."""
    pairs = _pairs(business, source_id, target_id)
    src, dst, _b = pairs[0]
    blocked = None
    try:
        for s, d, _biz in pairs:
            if d:
                _check(s, d)
    except MergeRefused as e:
        blocked = str(e)
    skus = list(FinalPrice.objects.filter(parent=src).order_by("sku_id").values_list("sku_id", flat=True))
    stock = {
        "purchases": PurchaseItem.objects.filter(parent_sku=src).count(),
        "adjustments": InventoryAdjustment.objects.filter(parent_sku=src).count(),
        "packed": PackedStockEvent.objects.filter(parent_sku=src).count(),
    }
    price = lambda p: {f: (str(getattr(p, f)) if getattr(p, f) is not None else None) for f in PRICE_FIELDS}
    return {
        "source": {"item_id": src.item_id, "skus": skus, "price": price(src), "image_url": src.image_url,
                   "history": ParentPriceHistory.objects.filter(parent=src).count(), "paused": ListingHubPause.objects.filter(parent=src).exists(),
                   "product": bool(_product(src)), **stock},
        "target": {"item_id": dst.item_id, "skus": FinalPrice.objects.filter(parent=dst).count(), "price": price(dst),
                   "image_url": dst.image_url, "history": ParentPriceHistory.objects.filter(parent=dst).count(),
                   "paused": ListingHubPause.objects.filter(parent=dst).exists(), "product": bool(_product(dst))},
        # SKUs whose price changes: they take the target's.
        "price_changes": [sku for sku, fin in FinalPrice.objects.filter(parent=src).order_by("sku_id")
                          .values_list("sku_id", "final_price") if fin != dst.final_price],
        "also_in": [{"business": b.name, "renamed": d is None} for _s, d, b in pairs[1:]],
        "blocked": blocked,
    }


def _merge_one(source, target, user):
    """Carry everything of `source` over to `target`, then remove `source`. Returns what moved."""
    _check(source, target)
    moved = {"skus": 0}
    # SKUs: under the target, at the target's price (as linking does).
    children = list(FinalPrice.objects.filter(parent=source))
    for fp in children:
        fp.parent = target
        for f in PRICE_FIELDS:
            setattr(fp, f, getattr(target, f))
    FinalPrice.objects.bulk_update(children, ["parent", *PRICE_FIELDS], batch_size=500)
    moved["skus"] = len(children)

    for model, field in MOVED:
        moved[model.__name__] = model.objects.filter(**{field: source}).update(**{field: target})
    ReturnGuardAlert.objects.filter(parent=target, parent_item_id=source.item_id).update(parent_item_id=target.item_id)

    # Price history and bill of materials: the target's own, or the source's when the target has none.
    for model in (ParentPriceHistory, MasterItemComponent):
        if model.objects.filter(parent=target).exists():
            model.objects.filter(parent=source).delete()
        else:
            moved[model.__name__] = model.objects.filter(parent=source).update(parent=target)
    # Listing prices: one per marketplace, the target's first.
    have = set(ListingPrice.objects.filter(parent=target).values_list("platform", flat=True))
    ListingPrice.objects.filter(parent=source, platform__in=have).delete()
    ListingPrice.objects.filter(parent=source).update(parent=target)
    # Paused: if either was, the target is.
    if ListingHubPause.objects.filter(parent=target).exists():
        ListingHubPause.objects.filter(parent=source).delete()
    else:
        ListingHubPause.objects.filter(parent=source).update(parent=target)
    Product.objects.filter(parent_sku=source).update(parent_sku=target)
    if not target.image_url and source.image_url:
        ParentItemPrice.objects.filter(pk=target.pk).update(image_url=source.image_url)

    InventoryLog.objects.filter(business=source.business, parent_sku_id=source.item_id).update(parent_sku_id=target.item_id)
    InventoryLog.objects.create(
        business=source.business, entity_type="SKU", entity_id=str(target.pk), action="UPDATE", parent_sku_id=target.item_id,
        description=f"Parent {source.item_id} merged into {target.item_id}: {moved['skus']} SKU(s) moved"
                    f"{f' by {user.get_username()}' if user else ''}.",
        metadata={"merged_from": source.item_id, "moved": moved})

    # Nothing may still point at the source (a cascade would take it with it).
    for model, field in _relations():
        if model.objects.filter(**{field: source}).exists():
            raise MergeRefused(f"{model.__name__} still points at {source.item_id} — nothing was changed.",
                               status.HTTP_409_CONFLICT)
    ParentItemPrice.objects.filter(pk=source.pk).delete()
    return moved


def merge(business, source_id, target_id, user=None):
    """Merge parent `source_id` into `target_id` in `business` and every business sharing its pricing."""
    pairs = _pairs(business, source_id, target_id)
    done = []
    with transaction.atomic(), pricing_sync._SyncGuard():
        for src, dst, biz in pairs:
            if dst is None:
                # The sibling only has the source: it simply becomes the target there.
                ParentItemPrice.objects.filter(pk=src.pk).update(item_id=target_id)
                InventoryLog.objects.filter(business=biz, parent_sku_id=source_id).update(parent_sku_id=target_id)
                done.append({"business": biz.name, "renamed": True, "skus": FinalPrice.objects.filter(parent=src).count()})
                continue
            moved = _merge_one(src, dst, user)
            done.append({"business": biz.name, "renamed": False, **moved})
    for _s, _d, biz in pairs:
        api_cache.bump(biz.pk)
    return done


def _business(request, business_id):
    from .views import get_authorized_business
    return get_authorized_business(request, business_id)


@api_view(["GET", "POST"])
def parent_merge(request, business_id):
    """
    GET  ?source=&target=   what merging `source` into `target` would do.
    POST {source, target}   merge: every SKU (and all else) of `source` moves to `target`; `source` is removed.
    """
    business = _business(request, business_id)
    data = request.GET if request.method == "GET" else request.data
    source_id, target_id = str(data.get("source") or "").strip(), str(data.get("target") or "").strip()
    if not source_id or not target_id:
        return Response({"error": "Pick the parent to merge and the one to keep."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        if request.method == "GET":
            return Response(preview(business, source_id, target_id))
        done = merge(business, source_id, target_id, request.user)
    except MergeRefused as e:
        return Response({"error": str(e)}, status=e.http)
    return Response({"merged": source_id, "into": target_id, "businesses": done})

