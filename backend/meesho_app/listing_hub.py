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
    Unit cost = item price + GST + packaging — the same cost the
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
from . import listing_hub_sources as src
from .models import (
    BulkListingBatch, FinalPrice, FlipkartOrderPayment, ListingHubLink, ListingHubPause, ListingImage, ListingPrice,
    ListingTemplate, Order, OrderPayment, ParentItemPrice, Product,
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


def _is_admin(request):
    from accounts.models import User
    return getattr(request.user, "role", None) == User.ROLE_SUPER_ADMIN


def _paused_ids(business):
    return set(ListingHubPause.objects.filter(business=business).values_list("parent_id", flat=True))


def _batches_for(business, parent, sheet_map):
    """Every listing sheet of this product, newest first, with how it matched."""
    ids = {bid: how for bid, (pids, how) in sheet_map.items() if parent.id in pids}
    batches = list(BulkListingBatch.objects.filter(id__in=ids).select_related("product").order_by("-created_at"))
    for b in batches:
        b.matched_by = ids[b.id]
    return batches


def _unit_cost(parent):
    """What one unit costs to sell: its final price."""
    return _d(parent.final_price)


def _card(p, sku_counts, photo_counts, platforms, cats, saved, paused, matched_sku=None):
    return {
        "id": p.id, "item_id": p.item_id, "image_url": p.image_url,
        "unit_cost": _money(_unit_cost(p)) if p.item_price else None,
        "priced": bool(p.item_price and p.item_price > 0),
        "sku_count": sku_counts.get(p.id, 0), "photo_count": photo_counts.get(p.id, 0),
        "listed_on": platforms.get(p.id, []),
        "categories": cats.get(p.id, []),
        "saved_prices": saved.get(p.id, {}),
        "paused": p.id in paused,
        "matched_sku": matched_sku,
    }


NO_SHEET = "No listing sheet yet"


@api_view(["GET"])
def hub_search(request, business_id):
    """?q= matches a parent id, any SKU id under it, or its product name.
    Empty q lists products, newest first. ?category= keeps products whose
    sheets were saved under that category ("No listing sheet yet" for none);
    ?status=paused lists paused products (admins only). ?offset= pages.

    Paused products are left out for everyone but admins."""
    business = get_authorized_business(request, business_id)
    admin = _is_admin(request)
    q = (request.GET.get("q") or "").strip()
    category = (request.GET.get("category") or "").strip()
    want_paused = admin and request.GET.get("status") == "paused"
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

    paused = _paused_ids(business)
    rows = [p for p in rows if (p.id in paused) == want_paused] if (want_paused or not admin) else rows
    sheet_map = src.sheet_parents(business)
    cats, platforms = src.parent_categories(business, sheet_map)

    # Category counts over what this person can see (before the category filter).
    counts = defaultdict(int)
    for p in rows:
        for c in cats.get(p.id) or [NO_SHEET]:
            counts[c] += 1
    if category:
        rows = [p for p in rows if category in (cats.get(p.id) or [NO_SHEET])]

    total = len(rows)
    page = rows[offset:offset + 48]
    sku_counts = dict(FinalPrice.objects.filter(business=business, parent_id__in=[p.id for p in page])
                      .values("parent_id").annotate(n=Count("id")).values_list("parent_id", "n"))
    saved = defaultdict(dict)
    for lp in ListingPrice.objects.filter(business=business, parent_id__in=[p.id for p in page]):
        saved[lp.parent_id][lp.platform] = _money(lp.price)
    photos = _photo_counts(business)
    unlinked = sum(1 for pids, _how in sheet_map.values() if not pids) if admin else 0
    return Response({
        "total": total, "offset": offset,
        "results": [_card(p, sku_counts, photos, platforms, cats, saved, paused, matched.get(p.id)) for p in page],
        "skus_without_parent": sorted(set(orphan_skus))[:20],
        "categories": sorted(({"label": k, "count": v} for k, v in counts.items()),
                             key=lambda c: (c["label"] == NO_SHEET, -c["count"], c["label"])),
        "is_admin": admin,
        "paused_count": len(paused) if admin else 0,
        "unlinked_sheets": unlinked,
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
    unit_cost = _unit_cost(parent)
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


def _gather(business, parent):
    """Everything saved about this product's listings, found once per request."""
    skus = _parent_skus(business, parent)
    link_map = src.links(business)
    sheet_map = src.sheet_parents(business, link_map)
    batches = _batches_for(business, parent, sheet_map)
    tmap = src.template_parents(business, link_map)
    tids = {tid: how for tid, (pids, how) in tmap.items() if parent.id in pids}
    templates = list(ListingTemplate.objects.filter(id__in=tids).order_by("-updated_at"))
    for t in templates:
        t.matched_by = tids[t.id]
    return {"skus": skus, "sheet_map": sheet_map, "batches": batches, "templates": templates}


def _photos(business, parent, batches, templates):
    """Every photo of the product without repeats: uploaded ones on record,
    the main image, anything else in its storage folder, then the image links
    in its listing sheets and extension templates. Returns (photos, note)."""
    seen, seen_keys, out = set(), set(), []

    def add(url, source, name, key=None):
        # The same stored file can be written as different links (encoding),
        # so a storage key counts as seen too.
        if not url or url in seen or (key and key in seen_keys) or len(out) >= MAX_PHOTOS:
            return
        seen.add(url)
        if key:
            seen_keys.add(key)
        out.append({"n": len(out) + 1, "url": url, "source": source, "name": name, "key": key})

    for img in (ListingImage.objects.filter(business=business, parent=parent, status=ListingImage.STATUS_UPLOADED)
                .order_by("image_no")):
        add(object_storage.public_url(img.key), "Uploaded", img.key.rsplit("/", 1)[-1], img.key)
    add(parent.image_url, "Main photo", "main-image")
    folder, note = src.folder_photos(business, parent)
    for key, url in folder:
        add(url, "Storage folder", key.rsplit("/", 1)[-1], key)
    for b in batches:
        label = f"{b.get_platform_display()} sheet"
        snap = b.payload_snapshot or {}
        for row in snap.get("rows", []):
            for u in row.get("images") or []:
                add(u, label, row.get("sku_id") or "")
        for u in snap.get("image_urls") or []:
            add(u, label, "")
    for t in templates:
        for u in src.template_images(t.fields):
            add(u, "Extension template", t.name)
    return out, note


def _sheet_rows(b, sku_set):
    """(common fields dict, per-SKU rows) of one sheet, limited to this
    product's SKUs when the sheet also carries other products."""
    snap = b.payload_snapshot or {}
    rows = snap.get("rows") or []
    mine = [r for r in rows if str(r.get("sku_id", "")).lower() in sku_set] or rows
    if b.platform == BulkListingBatch.PLATFORM_FLIPKART:
        common = dict((mine[0].get("attributes") if mine else {}) or {})
        per = [{"sku_id": r.get("sku_id"), "fields": dict(r.get("attributes") or {}), "images": r.get("images") or []}
               for r in mine]
    else:
        common = dict(snap.get("shared") or {})
        shared_imgs = snap.get("image_urls") or []
        per = [{"sku_id": r.get("sku_id"),
                "fields": {"product_name": r.get("product_name"), "style_id": r.get("style_id"),
                           "group_id": r.get("group_id"), **(r.get("overrides") or {})},
                "images": r.get("images") or shared_imgs} for r in mine]
    return common, per


def _listings(batches, templates, skus, pricing):
    """Every saved listing of this product, newest first, each with its
    details field by field and the problems found in it."""
    sku_set = {s.lower() for s in skus}
    breakeven = {k: v.get("breakeven") for k, v in (pricing.get("platforms") or {}).items()}
    out = []
    for b in batches:
        common, per = _sheet_rows(b, sku_set)
        out.append({
            "kind": "sheet", "id": b.id, "platform": b.platform, "category": b.category_label,
            "category_short": src.short_category(b.category_label), "filename": b.filename,
            "created_at": b.created_at, "rows": b.row_count, "matched_by": b.matched_by,
            "fields": _fields(common),
            "skus": [{"sku_id": r["sku_id"], "fields": _fields(r["fields"]), "images": r["images"][:12],
                      "image_count": len(r["images"])} for r in per[:40]],
            "issues": src.sheet_issues(b.platform, common, per, sku_set, breakeven.get(b.platform)),
        })
    for t in templates:
        fields = [{"key": k, "label": (t.labels or {}).get(k) or _label(k), "value": str(v)}
                  for k, v in (t.fields or {}).items() if v not in (None, "") and not isinstance(v, (list, dict))]
        out.append({
            "kind": "template", "id": t.id, "platform": "meesho", "category": "", "category_short": "Extension template",
            "filename": t.name, "created_at": t.updated_at, "matched_by": t.matched_by, "source_url": t.source_url,
            "fields": fields, "skus": [], "issues": [] if fields else [{"level": "error", "text": "This template has no saved values."}],
        })
    return out


def _parent_or_404(request, business, item_id):
    """The product, or a 404 — paused products count as missing for anyone
    who isn't an admin."""
    parent = ParentItemPrice.objects.filter(business=business, item_id__iexact=(item_id or "").strip()).first()
    if not parent:
        return None, Response({"error": f"No product '{item_id}'."}, status=status.HTTP_404_NOT_FOUND)
    if not _is_admin(request) and ListingHubPause.objects.filter(parent=parent).exists():
        return None, Response({"error": "This product is paused for listing. Ask an admin if it should be listed."},
                              status=status.HTTP_404_NOT_FOUND)
    return parent, None


@api_view(["GET"])
def hub_product(request, business_id):
    """?id=<parent item id> — the whole page for one product. ?target= sets
    the target profit per order (₹) for the recommended price."""
    business = get_authorized_business(request, business_id)
    parent, err = _parent_or_404(request, business, request.GET.get("id"))
    if err:
        return err
    target = None
    if request.GET.get("target"):
        try:
            target = max(Decimal("0"), Decimal(request.GET["target"]))
        except Exception:
            return Response({"error": "target must be a number"}, status=status.HTTP_400_BAD_REQUEST)

    g = _gather(business, parent)
    skus = g["skus"]
    order_stats = {r["sku"]: r for r in Order.objects.filter(business=business, sku__in=skus)
                   .values("sku").annotate(orders=Count("sub_order_no", distinct=True), last=Max("order_date"))}
    tasks = src.task_listings(business, skus)
    try:
        product = parent.product
    except Product.DoesNotExist:
        product = None
    pricing = _pricing(business, parent, skus, target)
    photos, photo_note = _photos(business, parent, g["batches"], g["templates"])
    listings = _listings(g["batches"], g["templates"], skus, pricing)
    pause = ListingHubPause.objects.filter(parent=parent).select_related("paused_by").first()

    def sku_row(sku):
        t = tasks.get(sku.lower()) or {}
        return {"sku_id": sku, "orders": order_stats.get(sku, {}).get("orders", 0),
                "last_order": order_stats.get(sku, {}).get("last"),
                "task": {k: (_money(v) if k in ("listing_price", "mrp", "wrong_defective_price") and v is not None else v)
                         for k, v in t.items() if k != "sku_id"} or None}

    return Response({
        "parent": {
            "id": parent.id, "item_id": parent.item_id, "image_url": parent.image_url,
            "item_price": _money(parent.item_price), "tax_percent": parent.tax_percent or 0,
            "packaging_cost": _money(parent.packaging_cost),
            "final_price": _money(parent.final_price),
        },
        "product": None if not product else {
            "name": product.name, "size": product.size, "weight": product.weight, "hsn_code": product.hsn_code,
            "description": product.description, "drive_link": product.drive_link,
        },
        "skus": sorted((sku_row(s) for s in skus), key=lambda x: (-x["orders"], x["sku_id"])),
        "photos": photos,
        "photo_note": photo_note,
        "storage_ready": object_storage.is_ready(),
        "listings": listings,
        "categories": sorted({l["category_short"] for l in listings if l["kind"] == "sheet"}),
        "issue_count": sum(1 for l in listings for i in l["issues"] if i["level"] == "error"),
        "pricing": pricing,
        "is_admin": _is_admin(request),
        "paused": None if not pause else {"note": pause.note, "at": pause.paused_at,
                                          "by": getattr(pause.paused_by, "username", None)},
    })


@api_view(["GET"])
def hub_photo_check(request, business_id):
    """?id=<parent> — does every photo link of this product still open as an image?"""
    business = get_authorized_business(request, business_id)
    parent, err = _parent_or_404(request, business, request.GET.get("id"))
    if err:
        return err
    g = _gather(business, parent)
    photos, _note = _photos(business, parent, g["batches"], g["templates"])
    results = src.check_links(photos, _allowed_host)
    return Response({"results": results, "broken": sum(1 for r in results if r["ok"] is False)})


@api_view(["POST"])
def hub_pause(request, business_id):
    """Admins: {id, paused: true|false, note?} — pause a product so listing
    managers no longer see it in the hub, or resume it."""
    business = get_authorized_business(request, business_id)
    if not _is_admin(request):
        return Response({"error": "Only an admin can pause or resume a product."}, status=status.HTTP_403_FORBIDDEN)
    parent = ParentItemPrice.objects.filter(business=business, item_id__iexact=str(request.data.get("id") or "")).first()
    if not parent:
        return Response({"error": "No such product."}, status=status.HTTP_404_NOT_FOUND)
    if request.data.get("paused"):
        ListingHubPause.objects.update_or_create(parent=parent, defaults={
            "business": business, "note": str(request.data.get("note") or "")[:255], "paused_by": request.user})
        return Response({"paused": True})
    ListingHubPause.objects.filter(parent=parent).delete()
    return Response({"paused": False})


def _listing_object(business, kind, oid):
    if kind == ListingHubLink.KIND_SHEET:
        return BulkListingBatch.objects.filter(business=business, pk=oid).first()
    if kind == ListingHubLink.KIND_TEMPLATE:
        return ListingTemplate.objects.filter(business=business, pk=oid).first()
    return None


@api_view(["POST"])
def hub_link(request, business_id):
    """Admins: {kind: sheet|template, object_id, id: <parent> | null} —
    say which product a saved listing belongs to (null removes the link, so
    the automatic match applies again)."""
    business = get_authorized_business(request, business_id)
    if not _is_admin(request):
        return Response({"error": "Only an admin can link listings to products."}, status=status.HTTP_403_FORBIDDEN)
    kind = request.data.get("kind")
    try:
        oid = int(request.data.get("object_id"))
    except (TypeError, ValueError):
        return Response({"error": "object_id is required."}, status=status.HTTP_400_BAD_REQUEST)
    if not _listing_object(business, kind, oid):
        return Response({"error": "That listing doesn't exist."}, status=status.HTTP_404_NOT_FOUND)
    target = request.data.get("id")
    if not target:
        ListingHubLink.objects.filter(business=business, kind=kind, object_id=oid).delete()
        return Response({"linked": None})
    parent = ParentItemPrice.objects.filter(business=business, item_id__iexact=str(target)).first()
    if not parent:
        return Response({"error": "No such product."}, status=status.HTTP_404_NOT_FOUND)
    ListingHubLink.objects.update_or_create(business=business, kind=kind, object_id=oid,
                                            defaults={"parent": parent, "linked_by": request.user})
    return Response({"linked": parent.item_id})


@api_view(["GET"])
def hub_unlinked(request, business_id):
    """Admins: saved listings no product claims yet, each with the products
    it most looks like. ?for=<parent> ranks them for that one product."""
    business = get_authorized_business(request, business_id)
    if not _is_admin(request):
        return Response({"error": "Only an admin can link listings."}, status=status.HTTP_403_FORBIDDEN)
    link_map = src.links(business)
    sheet_map = src.sheet_parents(business, link_map)
    tmap = src.template_parents(business, link_map)
    focus = ParentItemPrice.objects.filter(business=business, item_id__iexact=request.GET.get("for") or "").first()
    out = []
    for b in BulkListingBatch.objects.filter(id__in=[k for k, (p, _h) in sheet_map.items() if not p]).order_by("-created_at"):
        text = src.sheet_text(b)
        out.append({"kind": "sheet", "object_id": b.id, "platform": b.platform, "name": b.filename,
                    "category": src.short_category(b.category_label), "created_at": b.created_at,
                    "sku_ids": (b.sku_ids or [])[:6], "suggestions": src.suggest_parents(business, text), "_text": text})
    for t in ListingTemplate.objects.filter(id__in=[k for k, (p, _h) in tmap.items() if not p]).order_by("-updated_at"):
        text = f"{t.name} " + " ".join(str(v) for v in list((t.fields or {}).values())[:20])
        out.append({"kind": "template", "object_id": t.id, "platform": "meesho", "name": t.name,
                    "category": "Extension template", "created_at": t.updated_at, "sku_ids": [],
                    "suggestions": src.suggest_parents(business, text), "_text": text})
    if focus:
        from difflib import SequenceMatcher
        for o in out:
            o["match_for_focus"] = round(max(
                SequenceMatcher(None, src._norm(focus.item_id), src._norm(o["_text"])[:200]).ratio(),
                1.0 if any(s["item_id"] == focus.item_id for s in o["suggestions"]) else 0), 2)
        out.sort(key=lambda o: -o["match_for_focus"])
    for o in out:
        o.pop("_text", None)
    return Response({"results": out})


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
    parent, err = _parent_or_404(request, business, request.GET.get("id"))
    if err:
        return business, None, []
    g = _gather(business, parent)
    return business, parent, _photos(business, parent, g["batches"], g["templates"])[0]


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
