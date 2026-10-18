"""
Where a product's listings and photos come from, for the Listing Hub.

Listings (everything typed into a listing form for this product):
  * Bulk Listing sheets — Meesho and Flipkart. A sheet belongs to a product if
    an admin linked it (ListingHubLink, always wins), else if it was made for
    that product (its saved parent, or its Product page link), else if any of
    its SKU ids sit under the product on SKU Pricing.
  * Browser-extension templates (ListingTemplate) — linked by an admin, else
    matched when the template's name or values carry the product's name or
    one of its SKU ids.
  * Team Tasks listings (TaskListing) — the listing price / MRP / HSN a lister
    entered for each SKU.

Photos: uploaded ones on record, the product's main image, every image in the
product's folder in storage (Cloudflare R2 — so photos uploaded elsewhere, or
whose record is missing, still show), and the image links in its sheets and
templates. Any of them can be checked: a HEAD request per link says whether
it still opens as an image.

Each sheet is also checked for the things that get a listing rejected or sold
at a loss — missing HSN / GST / MRP / price / weight / photos, MRP below the
price, a price below break-even, SKU ids that aren't under this product.
"""

import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher

import requests
from django.conf import settings

from . import object_storage
from .models import (
    BulkListingBatch, FinalPrice, ListingHubLink, ListingImage, ListingTemplate, ParentItemPrice, TaskListing,
)

IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")
URL_RE = re.compile(r"https?://[^\s\"'<>,]+", re.IGNORECASE)


# ── links ────────────────────────────────────────────────────────────────────

def links(business):
    """kind -> {object_id: parent_id} for every admin link in the business."""
    out = {ListingHubLink.KIND_SHEET: {}, ListingHubLink.KIND_TEMPLATE: {}}
    for kind, oid, pid in ListingHubLink.objects.filter(business=business).values_list("kind", "object_id", "parent_id"):
        out[kind][oid] = pid
    return out


def sheet_parents(business, link_map=None):
    """batch id -> (set of parent ids, how it was matched) for every sheet."""
    link_map = link_map if link_map is not None else links(business)
    manual = link_map[ListingHubLink.KIND_SHEET]
    by_item = {p.item_id.lower(): p.id for p in ParentItemPrice.objects.filter(business=business).only("item_id")}
    sku_parent = {s.lower(): p for s, p in FinalPrice.objects.filter(business=business, parent__isnull=False)
                  .values_list("sku_id", "parent_id")}
    out = {}
    for b in BulkListingBatch.objects.filter(business=business).select_related("product").only(
            "id", "sku_ids", "payload_snapshot", "product__parent_sku_id"):
        if b.id in manual:
            out[b.id] = ({manual[b.id]}, "linked")
            continue
        pid = by_item.get(str((b.payload_snapshot or {}).get("parent") or "").lower())
        if pid:
            out[b.id] = ({pid}, "made for it")
        elif b.product_id and b.product:
            out[b.id] = ({b.product.parent_sku_id}, "made for it")
        else:
            ids = {sku_parent.get(str(s).lower()) for s in (b.sku_ids or [])} - {None}
            out[b.id] = (ids, "SKU ids") if ids else (set(), None)
    return out


def _norm(text):
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def template_parents(business, link_map=None):
    """template id -> (set of parent ids, how matched)."""
    link_map = link_map if link_map is not None else links(business)
    manual = link_map[ListingHubLink.KIND_TEMPLATE]
    parents = list(ParentItemPrice.objects.filter(business=business).only("item_id"))
    skus_of = defaultdict(set)
    for s, p in FinalPrice.objects.filter(business=business, parent__isnull=False).values_list("sku_id", "parent_id"):
        skus_of[p].add(s.lower())
    out = {}
    for t in ListingTemplate.objects.filter(business=business).only("id", "name", "fields"):
        if t.id in manual:
            out[t.id] = ({manual[t.id]}, "linked")
            continue
        name = _norm(t.name)
        values = {str(v).strip().lower() for v in (t.fields or {}).values() if v not in (None, "")}
        hits = set()
        for p in parents:
            pn = _norm(p.item_id)
            if (pn and len(pn) >= 4 and (pn == name or f" {pn} " in f" {name} ")) or (skus_of[p.id] & values):
                hits.add(p.id)
        out[t.id] = (hits, "name / SKU id") if hits else (set(), None)
    return out


# ── categories ───────────────────────────────────────────────────────────────

def short_category(label):
    """'Puja Articles Template (Home & Kitchen/Home Decor/…/Puja Articles)' -> 'Puja Articles'."""
    label = (label or "").strip()
    if not label:
        return "Uncategorised"
    m = re.search(r"\(([^()]*)\)\s*$", label)
    if m and "/" in m.group(1):
        return m.group(1).split("/")[-1].strip() or label
    return re.sub(r"\s+template$", "", label, flags=re.IGNORECASE).strip() or label


def parent_categories(business, sheet_map=None):
    """parent id -> sorted list of short categories its sheets were saved under."""
    sheet_map = sheet_map if sheet_map is not None else sheet_parents(business)
    cats = dict(BulkListingBatch.objects.filter(business=business).values_list("id", "category_label"))
    platforms = dict(BulkListingBatch.objects.filter(business=business).values_list("id", "platform"))
    out_c, out_p = defaultdict(set), defaultdict(set)
    for bid, (pids, _how) in sheet_map.items():
        for pid in pids:
            out_c[pid].add(short_category(cats.get(bid)))
            out_p[pid].add(platforms.get(bid))
    return {k: sorted(v) for k, v in out_c.items()}, {k: sorted(v - {None}) for k, v in out_p.items()}


# ── suggestions for unlinked listings ────────────────────────────────────────

def _tokens(text):
    return {t for t in _norm(re.sub(r"\d+", " ", text or "")).split() if len(t) >= 3}


def suggest_parents(business, text, limit=3):
    """Products whose name looks most like `text` (SKU ids, titles, category)."""
    want = _tokens(text)
    flat = _norm(text)
    scored = []
    for p in ParentItemPrice.objects.filter(business=business).only("id", "item_id"):
        have = _tokens(p.item_id)
        overlap = len(want & have) / len(have) if have else 0
        ratio = SequenceMatcher(None, _norm(p.item_id), flat[:200]).ratio()
        score = max(overlap, ratio * 0.8)
        if score >= 0.34:
            scored.append((score, p))
    scored.sort(key=lambda x: -x[0])
    return [{"item_id": p.item_id, "score": round(s, 2)} for s, p in scored[:limit]]


def sheet_text(b):
    snap = b.payload_snapshot or {}
    names = [r.get("product_name") or (r.get("attributes") or {}).get("model_name") or "" for r in snap.get("rows", [])[:5]]
    return " ".join([*(b.sku_ids or [])[:5], *names, b.category_label or "", b.filename or ""])


# ── photos from the storage folder ───────────────────────────────────────────

def _prefixes(business):
    """Storage prefixes this business's photos live under: the configured one,
    and any other seen on its existing photos (dev and production share a
    bucket under different prefixes)."""
    found = {settings.S3_KEY_PREFIX}
    marker = f"/{business.pk}/"
    for key in ListingImage.objects.filter(business=business).values_list("key", flat=True)[:500]:
        if marker in key:
            found.add(key.split(marker, 1)[0])
    return sorted(p for p in found if p)


def _list(prefix, delimiter=None):
    client = object_storage._client()
    kwargs = {"Bucket": settings.S3_BUCKET, "Prefix": prefix}
    if delimiter:
        kwargs["Delimiter"] = delimiter
    token = None
    while True:
        if token:
            kwargs["ContinuationToken"] = token
        resp = client.list_objects_v2(**kwargs)
        yield resp
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")


def folder_photos(business, parent, limit=80):
    """Every image in this product's folder(s) in storage, as (key, url).

    The folders tried are the ones its uploaded photos went into, and its own
    name as a folder — matched case-insensitively against what's really in the
    bucket. A folder that belongs to a different product is never used."""
    if not object_storage.is_ready():
        return [], None
    from .listing_images_views import _file_base

    owners = defaultdict(set)
    for folder, pid in ListingImage.objects.filter(business=business).exclude(folder="").values_list("folder", "parent_id"):
        owners[folder.casefold()].add(pid)
    wanted = {f.casefold() for f in ListingImage.objects.filter(business=business, parent=parent)
              .exclude(folder="").values_list("folder", flat=True)}
    own_name = _file_base(parent.item_id).casefold()
    if own_name and (owners.get(own_name, set()) - {None} <= {parent.pk}):
        wanted.add(own_name)
    if not wanted:
        return [], None
    out = []
    try:
        for prefix in _prefixes(business):
            base = f"{prefix}/{business.pk}/"
            for page in _list(base, delimiter="/"):
                for cp in page.get("CommonPrefixes", []):
                    folder = cp["Prefix"][len(base):].rstrip("/")
                    if folder.casefold() not in wanted:
                        continue
                    for objs in _list(cp["Prefix"]):
                        for o in objs.get("Contents", []):
                            if o["Key"].lower().endswith(IMAGE_EXT):
                                out.append((o["Key"], object_storage.public_url(o["Key"])))
                                if len(out) >= limit:
                                    return out, None
    except Exception as exc:   # storage unreachable: the rest of the page still works
        return out, f"Couldn't read the storage folder ({exc.__class__.__name__})."
    return out, None


# ── checking photo links ─────────────────────────────────────────────────────

def check_links(photos, allowed):
    """For each photo: does its link still open as an image?"""
    def one(p):
        url = p["url"]
        if not allowed(url):
            return {"n": p["n"], "ok": None, "reason": "Not a known image host — open it to check"}
        try:
            r = requests.head(url, timeout=8, allow_redirects=True)
            if r.status_code in (403, 405):        # some CDNs refuse HEAD
                r = requests.get(url, timeout=8, stream=True)
                r.close()
            ct = (r.headers.get("content-type") or "").lower()
            if r.status_code != 200:
                return {"n": p["n"], "ok": False, "reason": f"Link doesn't open (HTTP {r.status_code})"}
            if ct and not (ct.startswith("image/") or "octet-stream" in ct):
                return {"n": p["n"], "ok": False, "reason": f"Not an image ({ct.split(';')[0]})"}
            return {"n": p["n"], "ok": True, "reason": ""}
        except requests.RequestException as exc:
            return {"n": p["n"], "ok": False, "reason": f"Couldn't reach it ({exc.__class__.__name__})"}

    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(one, photos))


# ── checking a sheet's details ───────────────────────────────────────────────

def _num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


VALID_GST = {0, 3, 5, 12, 18, 28}


def sheet_issues(platform, common, rows, product_skus, breakeven):
    """Problems worth fixing before this sheet is used again. `common` is the
    sheet-level fields dict, `rows` the per-SKU dicts {sku_id, fields, images}."""
    issues = []

    def add(level, text):
        issues.append({"level": level, "text": text})

    def first(*keys):
        for k in keys:
            if str(common.get(k) or "").strip():
                return str(common[k]).strip()
            for r in rows:
                if str(r["fields"].get(k) or "").strip():
                    return str(r["fields"][k]).strip()
        return ""

    if platform == BulkListingBatch.PLATFORM_FLIPKART:
        need = [("HSN code", ("hsn",)), ("GST / tax code", ("tax_code",)), ("MRP", ("mrp_inr",)),
                ("Selling price", ("your_selling_price_inr",)), ("Weight", ("weight_kg", "weight_g")),
                ("Description", ("description",)), ("Model name", ("model_name",))]
        price, mrp = _num(first("your_selling_price_inr")), _num(first("mrp_inr"))
        hsn = first("hsn")
        gst = _num(re.sub(r"[^0-9.]", "", first("tax_code")) or None)
    else:
        need = [("HSN code", ("hsn_id",)), ("GST %", ("gst",)), ("MRP", ("mrp",)), ("Meesho price", ("meesho_price",)),
                ("Weight", ("weight", "net_weight_gms")), ("Wrong / defective return price", ("wrong_defective_returns_price",))]
        price, mrp = _num(first("meesho_price")), _num(first("mrp"))
        hsn = first("hsn_id")
        gst = _num(first("gst"))
        wdrp = _num(first("wrong_defective_returns_price"))
        if price and wdrp and wdrp < price:
            add("warning", f"Wrong/defective return price ₹{wdrp:g} is below the Meesho price ₹{price:g}.")
        no_title = [r["sku_id"] for r in rows if not str(r["fields"].get("product_name") or "").strip()]
        if no_title:
            add("error", f"{len(no_title)} SKU(s) have no product name: {', '.join(map(str, no_title[:4]))}.")

    missing = [label for label, keys in need if not first(*keys)]
    if missing:
        add("error", "Missing: " + ", ".join(missing) + ".")
    if price and mrp and mrp < price:
        add("error", f"MRP ₹{mrp:g} is lower than the selling price ₹{price:g}.")
    if price and breakeven and price < breakeven:
        add("warning", f"Price ₹{price:g} is below break-even (₹{breakeven}) — every order would lose money.")
    if hsn and not re.fullmatch(r"\d{4,8}", hsn):
        add("warning", f"HSN code “{hsn}” doesn't look right — it should be 4 to 8 digits.")
    if gst is not None and gst not in VALID_GST:
        add("warning", f"GST {gst:g}% isn't a standard GST rate.")
    no_photo = [r["sku_id"] for r in rows if not r.get("images")]
    if rows and no_photo:
        add("error", f"{len(no_photo)} SKU(s) have no photo: {', '.join(map(str, no_photo[:4]))}.")
    foreign = [r["sku_id"] for r in rows if r["sku_id"] and str(r["sku_id"]).lower() not in product_skus]
    if foreign:
        add("info", f"{len(foreign)} SKU id(s) in this sheet aren't under this product on SKU Pricing yet "
                    f"({', '.join(map(str, foreign[:3]))}{'…' if len(foreign) > 3 else ''}). They join it once the listing is approved.")
    return issues


def template_images(fields):
    """Image links found anywhere in an extension template's values."""
    out = []
    for v in (fields or {}).values():
        for u in URL_RE.findall(str(v)):
            if u.lower().split("?")[0].endswith(IMAGE_EXT) or "image" in u.lower() or "cataloging" in u.lower():
                out.append(u)
    return out


def task_listings(business, skus):
    """What listers entered per SKU in Team Tasks (latest per SKU)."""
    rows = {}
    for t in (TaskListing.objects.filter(business=business, sku_id__in=list(skus)).order_by("-id")
              .values("sku_id", "listing_price", "mrp", "wrong_defective_price", "hsn_code", "tax_percent", "status")):
        rows.setdefault(t["sku_id"].lower(), t)
    return rows
