"""
Listing Hub — everything a listing manager needs to list a product, in one place.

Search a parent product (or any of its SKU ids) and get, together:
  - every photo of it: the ones uploaded to storage, the parent's main image,
    and the image links used in its earlier Meesho / Flipkart listing sheets;
  - the details typed into those earlier listing sheets, field by field, so a
    new listing can be filled by copying instead of re-typing;
  - its SKU ids, with how much each has sold;
  - a recommended selling price per marketplace, and the price someone has
    actually set (ListingPrice), which wins when present.

How the recommended price is worked out — from this business's own data, not
assumed percentages:

  * Meesho's payout on a delivered order is almost exactly linear in the
    listing price (on real data: payout ≈ 0.985 × price − ₹6, within ±₹1.5),
    so a straight line is fitted to the business's own delivered orders.
  * A returned order costs the return fee (the average return settlement,
    ≈ −₹168) plus the box if the business counts it; an RTO costs the box.
  * How often this product is delivered / returned / RTO'd comes from its
    own orders when it has enough of them, else from the whole business.
  * Expected profit per order at price P is then
        d·(payout(P) − unit cost) + r·(return loss) + t·(RTO loss)
    and the recommended price is the P where that equals the target profit.
    Unit cost = item price + GST + packaging + loss buffer — the same cost the
    profit pages charge, so a product sold at this price shows that profit.
"""

import io
import re
import zipfile
from collections import Counter, defaultdict
from decimal import ROUND_CEILING, Decimal
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.db.models import Count, Max, Q
from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import object_storage
from .models import (
    BulkListingBatch, FinalPrice, FlipkartOrderPayment, ListingImage, ListingPrice, Order, OrderPayment,
    ParentItemPrice, Product,
)
from .permissions import get_authorized_business

MIN_OWN_ORDERS = 30        # below this a product's own return rate is mostly noise
MIN_FIT_ROWS = 50          # payouts needed to trust a fitted fee line
DEFAULT_TARGET_SHARE = Decimal("0.20")   # default target profit: 20% of unit cost …
MIN_DEFAULT_TARGET = Decimal("20")       # … but at least ₹20 an order
MAX_PHOTOS = 80
PHOTO_BYTES_CAP = 15 * 1024 * 1024
# Only these hosts are ever fetched server-side for downloads (listing-sheet
# images live on the marketplaces' CDNs; uploaded ones on our own bucket).
PHOTO_HOSTS = ("meeshosupplyassets.com", "meesho.com", "flixcart.com", "flipkart.com")


def _d(x):
    return Decimal(str(x if x not in (None, "") else 0))


def _money(x):
    return float(round(_d(x), 2))


# ── finding products ─────────────────────────────────────────────────────────

def _parent_skus(business, parent):
    return list(FinalPrice.objects.filter(business=business, parent=parent).values_list("sku_id", flat=True))


def _photo_counts(business):
    return dict(ListingImage.objects.filter(business=business, status=ListingImage.STATUS_UPLOADED, parent__isnull=False)
                .values("parent_id").annotate(n=Count("id")).values_list("parent_id", "n"))


def _batches_for(business, parent, skus):
    """Listing sheets made for this product: linked to it directly, or
    covering any of its SKU ids."""
    sku_set = {s.lower() for s in skus}
    out = []
    for b in BulkListingBatch.objects.filter(business=business).select_related("product").order_by("-created_at"):
        snap = b.payload_snapshot or {}
        snap_parent = str(snap.get("parent") or "").lower()
        if (snap_parent == parent.item_id.lower()
                or (b.product_id and b.product.parent_sku_id == parent.id)
                or any(str(s).lower() in sku_set for s in (b.sku_ids or []))):
            out.append(b)
    return out


def _listed_platforms(business):
    """parent id -> set of platforms it has listing sheets for."""
    sku_parent = {s.lower(): p for s, p in FinalPrice.objects.filter(business=business, parent__isnull=False)
                  .values_list("sku_id", "parent_id")}
    by_item = {p.item_id.lower(): p.id for p in ParentItemPrice.objects.filter(business=business).only("item_id")}
    out = defaultdict(set)
    for b in BulkListingBatch.objects.filter(business=business).only("platform", "sku_ids", "payload_snapshot"):
        pid = by_item.get(str((b.payload_snapshot or {}).get("parent") or "").lower())
        ids = {pid} if pid else {sku_parent.get(str(s).lower()) for s in (b.sku_ids or [])}
        for p in ids - {None}:
            out[p].add(b.platform)
    return out


def _card(p, sku_counts, photo_counts, listed, saved, matched_sku=None):
    return {
        "id": p.id, "item_id": p.item_id, "image_url": p.image_url,
        "unit_cost": _money(_d(p.final_price) + _d(p.buffer_amount)) if p.item_price else None,
        "priced": bool(p.item_price and p.item_price > 0),
        "sku_count": sku_counts.get(p.id, 0), "photo_count": photo_counts.get(p.id, 0),
        "listed_on": sorted(listed.get(p.id, ())),
        "saved_prices": saved.get(p.id, {}),
        "matched_sku": matched_sku,
    }


@api_view(["GET"])
def hub_search(request, business_id):
    """?q= matches a parent id, any SKU id under it, or its product name.
    Empty q lists products, newest first. ?offset= pages."""
    business = get_authorized_business(request, business_id)
    q = (request.GET.get("q") or "").strip()
    try:
        offset = max(0, int(request.GET.get("offset") or 0))
    except ValueError:
        offset = 0
    parents = ParentItemPrice.objects.filter(business=business)
    matched = {}
    orphan_skus = []
    if q:
        sku_hits = list(FinalPrice.objects.filter(business=business, sku_id__icontains=q)
                        .values_list("sku_id", "parent_id")[:200])
        for sku, pid in sku_hits:
            if pid:
                matched.setdefault(pid, sku)
            else:
                orphan_skus.append(sku)
        name_hits = set(Product.objects.filter(business=business, name__icontains=q).values_list("parent_sku_id", flat=True))
        name_hits |= set(ListingImage.objects.filter(business=business, product_name__icontains=q, parent__isnull=False)
                         .values_list("parent_id", flat=True))
        parents = parents.filter(Q(item_id__icontains=q) | Q(id__in=set(matched) | name_hits))
        # Exact id matches first, then the rest alphabetically.
        rows = sorted(parents, key=lambda p: (p.item_id.lower() != q.lower(), p.item_id.lower()))
    else:
        rows = list(parents.order_by("-id"))
    total = len(rows)
    page = rows[offset:offset + 48]

    sku_counts = dict(FinalPrice.objects.filter(business=business, parent_id__in=[p.id for p in page])
                      .values("parent_id").annotate(n=Count("id")).values_list("parent_id", "n"))
    saved = defaultdict(dict)
    for lp in ListingPrice.objects.filter(business=business, parent_id__in=[p.id for p in page]):
        saved[lp.parent_id][lp.platform] = _money(lp.price)
    listed = _listed_platforms(business)
    photos = _photo_counts(business)
    return Response({
        "total": total, "offset": offset,
        "results": [_card(p, sku_counts, photos, listed, saved, matched.get(p.id)) for p in page],
        "skus_without_parent": sorted(set(orphan_skus))[:20],
    })


# ── recommended price ────────────────────────────────────────────────────────

def _fit_line(pairs):
    """Least-squares payout = a·price + c over (price, payout) pairs."""
    n = len(pairs)
    sx = sum(p for p, _ in pairs)
    sy = sum(y for _, y in pairs)
    sxx = sum(p * p for p, _ in pairs)
    sxy = sum(p * y for p, y in pairs)
    den = n * sxx - sx * sx
    if not den:
        return None
    a = (n * sxy - sx * sy) / den
    return a, (sy - a * sx) / n


def _meesho_model(business, skus):
    from .views import _DELIVERED_STATUSES, _RETURN_STATUSES, _RTO_STATUSES, _EXCHANGE_STATUSES

    delivered = list(OrderPayment.objects.filter(
        business=business, live_order_status__iexact="Delivered", listing_price_incl_taxes__gt=0,
        final_settlement_amount__isnull=False).filter(Q(quantity=1) | Q(quantity__isnull=True))
        .order_by("-payment_date").values_list("listing_price_incl_taxes", "final_settlement_amount")[:20000])
    fit = _fit_line([(float(p), float(s)) for p, s in delivered]) if len(delivered) >= MIN_FIT_ROWS else None
    returns = [float(v) for v in OrderPayment.objects.filter(business=business, live_order_status__iexact="Return")
               .exclude(final_settlement_amount__isnull=True).values_list("final_settlement_amount", flat=True)[:20000]]
    rtos = [float(v) for v in OrderPayment.objects.filter(business=business, live_order_status__iexact="RTO")
            .exclude(final_settlement_amount__isnull=True).values_list("final_settlement_amount", flat=True)[:20000]]

    def outcome_counts(qs):
        seen = {}
        for sub, st in qs.exclude(live_order_status__isnull=True).values_list("sub_order_no", "live_order_status"):
            s = (st or "").upper()
            kind = ("rto" if s in _RTO_STATUSES else "return" if s in _RETURN_STATUSES
                    else "delivered" if s in _DELIVERED_STATUSES | _EXCHANGE_STATUSES else None)
            if kind and seen.get(sub) not in ("rto", "return"):
                seen[sub] = kind
        return Counter(seen.values())

    own = outcome_counts(OrderPayment.objects.filter(business=business, supplier_sku__in=skus)) if skus else Counter()
    use_own = sum(own.values()) >= MIN_OWN_ORDERS
    counts = own if use_own else outcome_counts(OrderPayment.objects.filter(business=business))
    return {
        "fit": fit, "fit_rows": len(delivered),
        "return_settlement": sum(returns) / len(returns) if returns else None,
        "rto_settlement": sum(rtos) / len(rtos) if rtos else 0.0,
        "counts": counts, "rates_from": "this product" if use_own else "your whole business",
        "own_orders": sum(own.values()),
    }


def _flipkart_model(business, skus):
    rows = list(FlipkartOrderPayment.objects.filter(business=business, sale_amount__gt=0)
                .values_list("order_item_id", "seller_sku", "sale_amount", "settlement_value", "return_type", "quantity")[:20000])
    groups = defaultdict(list)
    for r in rows:
        groups[r[0]].append(r)
    pairs, ret_settle, outcomes_all, outcomes_own = [], [], Counter(), Counter()
    sku_set = {s.lower() for s in skus}
    for g in groups.values():
        rt = next((x[4] for x in g if x[4] and x[4].upper() != "NA"), None)
        settle = sum(float(x[3] or 0) for x in g)
        kind = "rto" if rt and "courier" in rt.lower() else "return" if rt else "delivered"
        outcomes_all[kind] += 1
        if any(str(x[1] or "").lower() in sku_set for x in g):
            outcomes_own[kind] += 1
        if kind == "delivered" and all((x[5] or 1) == 1 for x in g):
            pairs.append((float(max(x[2] for x in g)), settle))
        elif kind != "delivered":
            ret_settle.append(settle)
    if len(pairs) < MIN_FIT_ROWS:
        return None
    use_own = sum(outcomes_own.values()) >= MIN_OWN_ORDERS
    return {
        "fit": _fit_line(pairs), "fit_rows": len(pairs),
        "return_settlement": sum(ret_settle) / len(ret_settle) if ret_settle else None,
        "rto_settlement": 0.0,
        "counts": outcomes_own if use_own else outcomes_all,
        "rates_from": "this product" if use_own else "your whole business",
        "own_orders": sum(outcomes_own.values()),
    }


def _round_up_9(x):
    """Next price ending in 9 at or above x — how most listings are priced."""
    n = int(_d(x).to_integral_value(rounding=ROUND_CEILING))
    return n + (9 - n % 10) % 10


def recommend(unit_cost, packaging, model, target, cost_setting, fallback_note=None):
    """The price P where expected profit per order = target, with the working."""
    from .models import BusinessCostSetting
    from .views import _packaging_charge

    counts = model["counts"]
    total = sum(counts.values())
    if total:
        d, r, t = (counts["delivered"] / total, counts["return"] / total, counts["rto"] / total)
    else:
        d, r, t = 1.0, 0.0, 0.0
    a, c = model["fit"] if model["fit"] else (1.0, 0.0)
    ret_fee = model["return_settlement"] if model["return_settlement"] is not None else 0.0
    ret_loss = ret_fee - float(_packaging_charge(BusinessCostSetting.RETURN, packaging, cost_setting))
    rto_loss = model["rto_settlement"] - float(_packaging_charge(BusinessCostSetting.RTO, packaging, cost_setting))
    cost = float(unit_cost)

    def expected_profit(price):
        return d * (a * price + c - cost) + r * ret_loss + t * rto_loss

    def price_for(goal):
        if d <= 0 or a <= 0:
            return None
        return ((goal - r * ret_loss - t * rto_loss) / d + cost - c) / a

    exact = price_for(float(target))
    breakeven = price_for(0.0)
    rec = _round_up_9(exact) if exact else None
    return {
        "recommended": rec,
        "exact": round(exact, 2) if exact else None,
        "breakeven": _round_up_9(breakeven) if breakeven else None,
        "target_profit": float(target),
        "profit_at_recommended": round(expected_profit(rec), 2) if rec else None,
        "working": {
            "unit_cost": round(cost, 2),
            "payout_per_rupee": round(a, 4), "payout_offset": round(c, 2), "fee_rows": model["fit_rows"],
            "delivered_pct": round(d * 100, 1), "return_pct": round(r * 100, 1), "rto_pct": round(t * 100, 1),
            "rates_from": model["rates_from"], "orders_seen": total,
            "loss_per_return": round(ret_loss, 2), "loss_per_rto": round(rto_loss, 2),
        },
        "note": fallback_note,
        "_coeffs": (d, r, t, a, c, ret_loss, rto_loss, cost),
    }


def profit_at(rec, price):
    d, r, t, a, c, ret_loss, rto_loss, cost = rec["_coeffs"]
    return round(d * (a * float(price) + c - cost) + r * ret_loss + t * rto_loss, 2)


def _pricing(business, parent, skus, target=None):
    from .views import _cost_setting

    cost_setting = _cost_setting(business)
    unit_cost = _d(parent.final_price) + _d(parent.buffer_amount)
    if target is None:
        target = max(MIN_DEFAULT_TARGET, (unit_cost * DEFAULT_TARGET_SHARE).quantize(Decimal("1")))
    priced = bool(parent.item_price and parent.item_price > 0)
    meesho = _meesho_model(business, skus)
    flip = _flipkart_model(business, skus)
    out = {"priced": priced, "unit_cost": _money(unit_cost), "default_target": float(target), "platforms": {}}
    saved = {lp.platform: lp for lp in ListingPrice.objects.filter(parent=parent).select_related("updated_by")}

    # The price it actually sells at today, from recent delivered orders.
    recent = sorted(float(p) for p in OrderPayment.objects.filter(
        business=business, supplier_sku__in=skus, live_order_status__iexact="Delivered", listing_price_incl_taxes__gt=0)
        .order_by("-payment_date").values_list("listing_price_incl_taxes", flat=True)[:50]) if skus else []
    current = {"meesho": recent[len(recent) // 2] if recent else None, "flipkart": None}

    for platform, model, note in (
        ("meesho", meesho, None),
        ("flipkart", flip or meesho,
         None if flip else "No Flipkart payments uploaded yet, so this uses Meesho's fee pattern. Upload Flipkart "
                           "payment sheets on Flipkart Profit to make it exact."),
    ):
        entry = {"saved": None, "current_selling_price": current[platform]}
        if priced:
            rec = recommend(unit_cost, _d(parent.packaging_cost), model, target, cost_setting, note)
            lp = saved.get(platform)
            if lp:
                entry["saved"] = {"price": _money(lp.price), "mrp": _money(lp.mrp) if lp.mrp else None, "note": lp.note,
                                  "updated_at": lp.updated_at, "updated_by": getattr(lp.updated_by, "username", None),
                                  "expected_profit": profit_at(rec, lp.price)}
            if current[platform]:
                entry["profit_at_current"] = profit_at(rec, current[platform])
            rec.pop("_coeffs")
            entry.update(rec)
        out["platforms"][platform] = entry
    return out


# ── product page ─────────────────────────────────────────────────────────────

_LABEL_FIXES = {"gst": "GST %", "mrp": "MRP", "hsn_id": "HSN code", "hsn": "HSN code", "mrp_inr": "MRP (₹)",
                "your_selling_price_inr": "Selling price (₹)", "meesho_price": "Meesho price (₹)",
                "wrong_defective_returns_price": "Wrong/defective return price (₹)", "sku_id": "SKU id"}


def _label(key):
    if key in _LABEL_FIXES:
        return _LABEL_FIXES[key]
    words = re.sub(r"[_\-]+", " ", key).strip()
    words = re.sub(r"\binr\b", "(₹)", words)
    words = re.sub(r"\b(cm|kg|g|ml|inch)\b", lambda m: f"({m.group(1)})", words)
    return words[:1].upper() + words[1:]


def _fields(d):
    return [{"key": k, "label": _label(k), "value": str(v)} for k, v in (d or {}).items()
            if v not in (None, "") and not isinstance(v, (list, dict))]


def _photos(business, parent, batches):
    """Every photo of the product, uploaded ones first, without repeats."""
    seen, out = set(), []

    def add(url, source, name, key=None):
        if url and url not in seen and len(out) < MAX_PHOTOS:
            seen.add(url)
            out.append({"n": len(out) + 1, "url": url, "source": source, "name": name, "key": key})

    for img in (ListingImage.objects.filter(business=business, parent=parent, status=ListingImage.STATUS_UPLOADED)
                .order_by("image_no")):
        add(object_storage.public_url(img.key), "uploaded", img.key.rsplit("/", 1)[-1], img.key)
    add(parent.image_url, "main", "main-image")
    for b in batches:
        src = f"{b.get_platform_display()} listing"
        snap = b.payload_snapshot or {}
        for row in snap.get("rows", []):
            for u in row.get("images") or []:
                add(u, src, row.get("sku_id") or "")
        for u in snap.get("image_urls") or []:
            add(u, src, "")
    return out


def _listings(batches, skus):
    """The newest Meesho and Flipkart listing data for this product, field by field."""
    sku_set = {s.lower() for s in skus}
    out = {}
    for b in batches:
        if b.platform in out:
            continue
        snap = b.payload_snapshot or {}
        rows = snap.get("rows") or []
        mine = [r for r in rows if str(r.get("sku_id", "")).lower() in sku_set] or rows
        if b.platform == BulkListingBatch.PLATFORM_FLIPKART:
            first = (mine[0].get("attributes") if mine else {}) or {}
            per_sku = [{"sku_id": r.get("sku_id"), "fields": _fields(r.get("attributes"))} for r in mine[:30]]
            common = _fields(first)
        else:
            common = _fields(snap.get("shared"))
            per_sku = [{"sku_id": r.get("sku_id"), "fields": _fields({
                "product_name": r.get("product_name"), "style_id": r.get("style_id"), "group_id": r.get("group_id"),
                **(r.get("overrides") or {})})} for r in mine[:30]]
        out[b.platform] = {
            "batch_id": b.id, "category": b.category_label, "filename": b.filename,
            "created_at": b.created_at, "fields": common, "skus": per_sku,
        }
    return out


@api_view(["GET"])
def hub_product(request, business_id):
    """?id=<parent item id> — the whole page for one product. ?target= sets
    the target profit per order (₹) for the recommended price."""
    business = get_authorized_business(request, business_id)
    item_id = (request.GET.get("id") or "").strip()
    parent = ParentItemPrice.objects.filter(business=business, item_id__iexact=item_id).first()
    if not parent:
        return Response({"error": f"No product '{item_id}'."}, status=status.HTTP_404_NOT_FOUND)
    target = None
    if request.GET.get("target"):
        try:
            target = max(Decimal("0"), Decimal(request.GET["target"]))
        except Exception:
            return Response({"error": "target must be a number"}, status=status.HTTP_400_BAD_REQUEST)

    skus = _parent_skus(business, parent)
    batches = _batches_for(business, parent, skus)
    order_stats = {r["sku"]: r for r in Order.objects.filter(business=business, sku__in=skus)
                   .values("sku").annotate(orders=Count("sub_order_no", distinct=True), last=Max("order_date"))}
    try:
        product = parent.product
    except Product.DoesNotExist:
        product = None

    return Response({
        "parent": {
            "id": parent.id, "item_id": parent.item_id, "image_url": parent.image_url,
            "item_price": _money(parent.item_price), "tax_percent": parent.tax_percent or 0,
            "packaging_cost": _money(parent.packaging_cost), "buffer": _money(parent.buffer_amount),
            "final_price": _money(parent.final_price),
        },
        "product": None if not product else {
            "name": product.name, "size": product.size, "weight": product.weight, "hsn_code": product.hsn_code,
            "description": product.description, "drive_link": product.drive_link,
        },
        "skus": sorted(({"sku_id": s, "orders": order_stats.get(s, {}).get("orders", 0),
                         "last_order": order_stats.get(s, {}).get("last")} for s in skus),
                       key=lambda x: (-x["orders"], x["sku_id"])),
        "photos": _photos(business, parent, batches),
        "storage_ready": object_storage.is_ready(),
        "listings": _listings(batches, skus),
        "batches": [{"id": b.id, "platform": b.platform, "category": b.category_label, "filename": b.filename,
                     "rows": b.row_count, "created_at": b.created_at, "sku_ids": (b.sku_ids or [])[:10]}
                    for b in batches[:20]],
        "pricing": _pricing(business, parent, skus, target),
    })


@api_view(["POST", "DELETE"])
def hub_price(request, business_id):
    """Save (POST {id, platform, price, mrp?, note?}) or clear (DELETE
    {id, platform}) the selling price listing managers should use."""
    business = get_authorized_business(request, business_id)
    data = request.data
    parent = ParentItemPrice.objects.filter(business=business, item_id__iexact=str(data.get("id") or "")).first()
    platform = data.get("platform")
    if not parent or platform not in dict(ListingPrice.PLATFORM_CHOICES):
        return Response({"error": "Pick a product and a platform."}, status=status.HTTP_400_BAD_REQUEST)
    if request.method == "DELETE":
        ListingPrice.objects.filter(parent=parent, platform=platform).delete()
        return Response({"cleared": True})
    try:
        price = Decimal(str(data.get("price")))
        mrp = Decimal(str(data["mrp"])) if data.get("mrp") not in (None, "") else None
    except Exception:
        return Response({"error": "Price must be a number."}, status=status.HTTP_400_BAD_REQUEST)
    if price <= 0:
        return Response({"error": "Price must be more than ₹0."}, status=status.HTTP_400_BAD_REQUEST)
    if mrp is not None and mrp < price:
        return Response({"error": "MRP can't be lower than the selling price."}, status=status.HTTP_400_BAD_REQUEST)
    lp, _ = ListingPrice.objects.update_or_create(
        parent=parent, platform=platform,
        defaults={"business": business, "price": price, "mrp": mrp, "note": str(data.get("note") or "")[:255],
                  "updated_by": request.user if request.user.is_authenticated else None})
    return Response({"saved": True, "price": _money(lp.price), "mrp": _money(lp.mrp) if lp.mrp else None})


# ── downloads ────────────────────────────────────────────────────────────────

def _allowed_host(url):
    host = (urlparse(url).hostname or "").lower()
    own = (urlparse(settings.S3_PUBLIC_BASE_URL).hostname or "").lower() if settings.S3_PUBLIC_BASE_URL else ""
    return bool(host) and (host == own or any(host == h or host.endswith("." + h) for h in PHOTO_HOSTS))


def _photo_bytes(business, photo):
    """Bytes of one photo from the product's own list — never an arbitrary url."""
    if photo.get("key") and object_storage.is_ready():
        data = object_storage.get_object_bytes(photo["key"])
        if data:
            return data, None
    if not _allowed_host(photo["url"]):
        return None, None
    try:
        r = requests.get(photo["url"], timeout=15, allow_redirects=False, stream=True)
        if r.status_code != 200:
            return None, None
        data = r.raw.read(PHOTO_BYTES_CAP + 1, decode_content=True)
        if len(data) > PHOTO_BYTES_CAP:
            return None, None
        return data, r.headers.get("content-type", "image/jpeg")
    except requests.RequestException:
        return None, None


def _ext(content_type, url):
    ct = (content_type or "").lower()
    if "png" in ct:
        return "png"
    if "webp" in ct:
        return "webp"
    m = re.search(r"\.(jpe?g|png|webp)(?:$|\?)", url.lower())
    return (m.group(1) if m else "jpg").replace("jpeg", "jpg")


def _safe(name):
    return re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-") or "product"


def _load_photos(request, business_id):
    business = get_authorized_business(request, business_id)
    parent = ParentItemPrice.objects.filter(business=business, item_id__iexact=(request.GET.get("id") or "").strip()).first()
    if not parent:
        return business, None, []
    skus = _parent_skus(business, parent)
    return business, parent, _photos(business, parent, _batches_for(business, parent, skus))


@api_view(["GET"])
def hub_photo(request, business_id):
    """?id=<parent>&n=<photo number> — one photo as a download."""
    business, parent, photos = _load_photos(request, business_id)
    try:
        photo = photos[int(request.GET.get("n")) - 1]
    except (TypeError, ValueError, IndexError):
        return Response({"error": "No such photo."}, status=status.HTTP_404_NOT_FOUND)
    data, ct = _photo_bytes(business, photo)
    if not data:
        return Response({"error": "That photo couldn't be fetched."}, status=status.HTTP_502_BAD_GATEWAY)
    resp = HttpResponse(data, content_type=ct or "image/jpeg")
    resp["Content-Disposition"] = f'attachment; filename="{_safe(parent.item_id)}-{photo["n"]}.{_ext(ct, photo["url"])}"'
    return resp


@api_view(["GET"])
def hub_photos_zip(request, business_id):
    """?id=<parent> — every photo of the product in one ZIP, numbered."""
    business, parent, photos = _load_photos(request, business_id)
    if not parent:
        return Response({"error": "No such product."}, status=status.HTTP_404_NOT_FOUND)
    buf, got = io.BytesIO(), 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in photos:
            data, ct = _photo_bytes(business, p)
            if data:
                got += 1
                zf.writestr(f"{_safe(parent.item_id)}-{p['n']:02d}.{_ext(ct, p['url'])}", data)
    if not got:
        return Response({"error": "None of this product's photos could be fetched."}, status=status.HTTP_502_BAD_GATEWAY)
    resp = HttpResponse(buf.getvalue(), content_type="application/zip")
    resp["Content-Disposition"] = f'attachment; filename="{_safe(parent.item_id)}-photos.zip"'
    resp["X-Photos-Included"] = str(got)
    resp["X-Photos-Missing"] = str(len(photos) - got)
    return resp
