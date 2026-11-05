"""
Which parent SKU (SKU Pricing's ParentItemPrice) an order's SKU belongs to —
for grouping orders and pick lists by parent — and linking a SKU that has no
parent yet, right from the Orders Panel or the labels list.

A SKU's parent comes from its FinalPrice row (SKU Pricing). Matching is the
database's: case-insensitive, and with Meesho's glued-on variation taken off
("long-carving-lota-001Free Size" is our "long-carving-lota-001").
"""

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import FinalPrice, ParentItemPrice

PATH = "meesho-orders/sku-parent/"


def _views():
    from . import views
    return views


def clean(sku, variation=""):
    return _views().meesho_sku(sku, variation)


def parents_for(skus_by_business):
    """{(business_id, sku key): {"parent": item_id, "image": url}} for every SKU given that has a parent."""
    key = _views()._sku_key
    out = {}
    for biz_id, skus in skus_by_business.items():
        skus = sorted({s for s in skus if s})
        for i in range(0, len(skus), 500):
            rows = (FinalPrice.objects.filter(business_id=biz_id, sku_id__in=skus[i:i + 500], parent__isnull=False)
                    .values_list("sku_id", "parent__item_id", "parent__image_url"))
            for sku, parent, image in rows:
                out[(biz_id, key(sku))] = {"parent": parent, "image": image or ""}
    return out


def lookup(index, business_id, sku):
    return index.get((business_id, _views()._sku_key(sku or "")))


def linkable_ids(request, businesses):
    """The businesses on screen this person may link SKUs to parents in: admins,
    and anyone SKU Pricing's linking is open to."""
    from accounts.access import api_access_denied
    v = _views()
    if v._is_admin(request.user):
        return [b.pk for b in businesses]
    return [b.pk for b in businesses if not api_access_denied(request.user, b, "link-sku/")]


def _target(request, business_id):
    """The business a link is for — one this person can open and may link in — or (None, Response)."""
    v = _views()
    on_screen = v.get_authorized_business(request, business_id)
    try:
        want = int((request.data if request.method == "POST" else request.GET).get("business") or on_screen.pk)
    except (TypeError, ValueError):
        return None, Response({"error": "Which business?"}, status=status.HTTP_400_BAD_REQUEST)
    biz = next((b for b in v.accessible_businesses(request, include=on_screen) if b.pk == want), None)
    if not biz:
        return None, Response({"error": "That business isn't yours to change."}, status=status.HTTP_403_FORBIDDEN)
    if not linkable_ids(request, [biz]):
        return None, Response({"error": "Linking SKUs to parents needs SKU Pricing access — ask an admin."},
                              status=status.HTTP_403_FORBIDDEN)
    return biz, None


@api_view(["GET", "POST"])
def sku_parent(request, business_id):
    """
    GET ?business=&sku=   the parents of that business to pick from, the likeliest first.
    POST {business, sku, parent}   link the SKU to the parent. As on SKU Pricing, the SKU then
    takes the parent's price; a SKU only seen in orders gets its SKU Pricing row made.
    """
    biz, err = _target(request, business_id)
    if err:
        return err
    if request.method == "GET":
        from .listing_hub_sources import suggest_parents
        sku = clean(request.GET.get("sku") or "")
        current = FinalPrice.objects.filter(business=biz, sku_id=sku).select_related("parent").first() if sku else None
        return Response({
            "business": {"id": biz.pk, "name": biz.name}, "sku": sku,
            "current": current.parent.item_id if current and current.parent else None,
            "suggestions": suggest_parents(biz, sku, limit=5) if sku else [],
            "parents": list(ParentItemPrice.objects.filter(business=biz).order_by("item_id").values_list("item_id", flat=True)[:5000]),
        })
    sku = clean(str(request.data.get("sku") or ""))
    parent_id = str(request.data.get("parent") or "").strip()
    if not sku or not parent_id:
        return Response({"error": "Pick the SKU and the parent."}, status=status.HTTP_400_BAD_REQUEST)
    parent = ParentItemPrice.objects.filter(business=biz, item_id=parent_id).first()
    if not parent:
        return Response({"error": f"{biz.name} has no parent “{parent_id}” on SKU Pricing."}, status=status.HTTP_404_NOT_FOUND)
    result = _views()._bulk_link_skus_to_parent(business=biz, parent=parent, sku_ids=[sku])
    if result["failed"]:
        return Response({"error": f"Couldn't link {sku}."}, status=status.HTTP_409_CONFLICT)
    return Response({"sku": sku, "parent": parent.item_id, "business": biz.name, "created": result["created"] > 0})
