"""
Product photos for orders and returns: Meesho's own picture of the product
when the sync has one and it checks out, else the parent SKU's.

  meesho_image(url)   the URL if it is a Meesho product image (https, on
                      Meesho's image host, an image file), else ""
  photo_map(rows)     {(business_id, sub-order): (photo, fallback)} for a page
                      of orders/returns/labels — Meesho's photo of the return,
                      else of the order, else the parent SKU's; the fallback is
                      the parent SKU's, for when Meesho's doesn't load
"""

import re
from urllib.parse import urlsplit

from .models import Order
from .return_images import _norm, return_image_map

HOSTS = ("images.meesho.com",)
_IMAGE_PATH = re.compile(r"\.(jpe?g|png|webp|gif|avif)$", re.I)
MAX_LEN = 500


def meesho_image(url):
    url = str(url or "").strip()
    if not url or len(url) > MAX_LEN:
        return ""
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not (host in HOSTS or host.endswith(".meesho.com")):
        return ""
    return url if _IMAGE_PATH.search(parts.path) else ""


def order_images(pairs):
    """{(business_id, sub-order): Meesho's photo} for these (business_id, sub-order) pairs."""
    wanted = {}
    for biz, sub in pairs:
        if biz and sub:
            wanted.setdefault(biz, set()).add(sub)
    out = {}
    for biz, subs in wanted.items():
        subs = list(subs)
        for i in range(0, len(subs), 500):
            for sub, url in (Order.objects.filter(business_id=biz, sub_order_no__in=subs[i:i + 500])
                             .exclude(meesho_image_url__isnull=True).exclude(meesho_image_url="")
                             .order_by("created_at").values_list("sub_order_no", "meesho_image_url")):
                if meesho_image(url):
                    out[(biz, sub)] = url        # the latest row's wins
    return out


def photo_map(rows, sub_of=lambda r: r.suborder_no, own=lambda r: getattr(r, "meesho_image_url", "")):
    """
    {(business_id, sub-order): (photo, fallback)} for `rows` (anything with
    business_id and sku). `sub_of` reads a row's sub-order number, `own` its
    own Meesho photo (a return's), if it has one.
    """
    rows = list(rows)
    parents = return_image_map(rows)
    need_order = [(r.business_id, sub_of(r)) for r in rows if not meesho_image(own(r))]
    from_order = order_images(need_order)
    out = {}
    for r in rows:
        key = (r.business_id, sub_of(r))
        parent = parents.get((r.business_id, _norm(r.sku))) if r.sku else None
        mine = meesho_image(own(r)) or from_order.get(key)
        out[key] = (mine or parent, parent if mine else None)
    return out
