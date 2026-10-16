"""
Product photo for a returned parcel.

A return carries no picture of its own, but its SKU usually belongs to a parent
SKU that has one: the pasted/uploaded image_url, else the first photo uploaded
for that parent. Resolved for a whole page of returns at once — one query per
business, not per row — and handed to the serializer through its context.
"""

from . import object_storage
from .models import FinalPrice, ListingImage


def _norm(sku):
    from .views import _sku_key  # late: views imports the serializers
    return _sku_key(sku or "")


def return_image_map(rows):
    """{(business_id, normalised sku): image url} for the SKUs of `rows`."""
    wanted = {}
    for r in rows:
        if r.sku:
            wanted.setdefault(r.business_id, set()).add(_norm(r.sku))
    out = {}
    for business_id, skus in wanted.items():
        parents = {}
        for sku_id, parent_id, image_url in (
            FinalPrice.objects.filter(business_id=business_id, parent__isnull=False)
            .values_list("sku_id", "parent_id", "parent__image_url")
        ):
            key = _norm(sku_id)
            if key in skus:
                parents[key] = (parent_id, (image_url or "").strip())
        # Parents with no image of their own fall back to their first uploaded photo.
        bare = {pid for pid, url in parents.values() if not url}
        first_photo = {}
        if bare:
            for pid, key in (
                ListingImage.objects.filter(parent_id__in=bare, status=ListingImage.STATUS_UPLOADED)
                .order_by("-image_no").values_list("parent_id", "key")
            ):
                first_photo[pid] = key          # ascending overwrite → lowest number wins
        for key, (pid, url) in parents.items():
            if url:
                out[(business_id, key)] = url
            elif pid in first_photo:
                out[(business_id, key)] = object_storage.public_url(first_photo[pid])
    return out
