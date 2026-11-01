"""
Find a SKU on Meesho, in every business — for Listing Lookup when the SKU has
no parent SKU here: Meesho's own search (Inventory → search, by product), asked
with each business's saved session, all at once. The businesses whose listings
carry that SKU come first, with the product's photo, name, catalog, price,
stock and status as Meesho shows them.

Read-only: it searches, and never changes anything on Meesho.
"""

import json
from concurrent.futures import ThreadPoolExecutor

import requests
from django.core.cache import cache
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .meesho_images import meesho_image
from .meesho_linking import MEESHO_BASE, USER_AGENT
from .models import MeeshoAccount

SEARCH_PATH = "/api/services/catalogManagement/fetchV2SearchResults"
TIMEOUT = 12                     # seconds per business; they are asked side by side
MAX_PRODUCTS = 8                 # per business
CACHE_SECONDS = 10 * 60          # the same SKU looked up again soon isn't asked twice
SESSION_GONE = (401, 403, 463)   # 463: "Unauthorized call. Token missing." — the session expired


def _views():
    from . import views
    return views


def _key(s):
    return "".join(str(s or "").lower().split())


def products_of(answer, query):
    """Meesho's search answer → one row per product, the exact SKU matches first."""
    want = _key(query)
    out = []
    for cat in (answer or {}).get("catalogs") or []:
        if not isinstance(cat, dict):
            continue
        for group in cat.get("product_groups") or []:
            for p in (group or {}).get("products") or []:
                if not isinstance(p, dict):
                    continue
                archived = bool(p.get("is_user_archived") or p.get("userArchived"))
                out.append({
                    "sku": p.get("style_id") or "", "sku_id": p.get("sku_id") or "", "name": p.get("name") or "",
                    "variation": p.get("variation") or "", "product_id": p.get("id"),
                    "image_url": meesho_image(p.get("image_url")) or meesho_image((cat.get("catalog_image_urls") or [None])[0]) or None,
                    "price": p.get("selling_price") if p.get("selling_price") is not None else p.get("meesho_price"),
                    "stock": p.get("inventory"),
                    "status": "Archived" if archived else str(group.get("catalog_status_l1") or "").replace("_", " ").capitalize() or None,
                    "archived_at": p.get("archived_at"),
                    "catalog_id": cat.get("id"), "catalog_name": cat.get("name") or "", "category": cat.get("category") or "",
                    # Meesho's sku_id is the SKU and the size run together ("lota-004Free Size").
                    "exact": bool(want) and want in (_key(p.get("style_id")), _key(p.get("sku_id")),
                                                     _key(p.get("sku_id"))[: -len(_key(p.get("variation")))] if p.get("variation") else None),
                })
    out.sort(key=lambda r: (not r["exact"], r["status"] == "Archived"))
    return out[:MAX_PRODUCTS]


def search_account(account, query):
    """Ask Meesho for `query` with this account's session. Returns this business's result."""
    base = {"business_id": account.business_id, "business_name": account.business.name}
    cached = cache.get(f"meesho-search:{account.pk}:{_key(query)}")
    if cached is not None:
        return {**base, **cached}
    from . import meesho_sync
    try:
        cookies = json.loads(meesho_sync.decrypt(account.cookies_enc)) if account.cookies_enc else None
    except Exception:                                           # noqa: BLE001
        cookies = None
    if not cookies:
        return {**base, "state": "no_session", "message": "No Meesho session — log in under Meesho → Settings.", "products": []}
    headers = {
        "accept": "application/json, text/plain, */*", "client-type": "d-web", "client-version": "v1",
        "content-type": "application/json;charset=UTF-8", "identifier": account.supplier_identifier,
        "origin": MEESHO_BASE, "user-agent": USER_AGENT,
        "referer": f"{MEESHO_BASE}/panel/v3/new/services/{account.supplier_identifier}/inventory/search?type=product",
        "cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()),
    }
    if account.browser_id:
        headers["browser-id"] = account.browser_id
    body = {"query": query, "query_type": "product", "supplier_id": int(account.supplier_id or 0), "fetch_price_reco": False,
            "fetch_transfer_price": False, "is_hasp_seller": False, "gst_type": "GSTIN"}
    try:
        res = requests.post(MEESHO_BASE + SEARCH_PATH, json=body, headers=headers, timeout=TIMEOUT)
    except requests.RequestException as exc:
        return {**base, "state": "error", "message": f"Couldn't reach Meesho ({exc.__class__.__name__}).", "products": []}
    if res.status_code in SESSION_GONE:
        return {**base, "state": "no_session", "message": "The Meesho session has expired — log in again under Meesho → Settings.",
                "products": []}
    try:
        answer = res.json()
    except ValueError:
        answer = None
    if res.status_code >= 400 or not isinstance(answer, dict):
        msg = (answer or {}).get("message") if isinstance(answer, dict) else None
        return {**base, "state": "error", "message": f"Meesho answered HTTP {res.status_code}{f': {msg}' if msg else ''}.",
                "products": []}
    products = products_of(answer, query)
    found = {"state": "found" if any(p["exact"] for p in products) else ("similar" if products else "none"),
             "message": "", "products": products}
    cache.set(f"meesho-search:{account.pk}:{_key(query)}", found, CACHE_SECONDS)
    return {**base, **found}


@api_view(["GET"])
def meesho_sku_search(request, business_id):
    """
    Listing Lookup, for a SKU with no parent: ?sku= searched on Meesho in every
    business this person's desk combines, side by side. The businesses that
    list that SKU come first.
    """
    business = _views().get_authorized_business(request, business_id)
    query = (request.GET.get("sku") or "").strip()[:120]
    if not query:
        return Response({"error": "sku is required"}, status=status.HTTP_400_BAD_REQUEST)
    desk = _views()._scan_desk_scope(request, business, api_path="order-scan/lookup/")
    accounts = list(MeeshoAccount.objects.filter(business__in=desk).exclude(status=MeeshoAccount.STATUS_DISABLED)
                    .exclude(supplier_id="").exclude(supplier_identifier="").select_related("business"))
    if not accounts:
        return Response({"sku": query, "results": [], "found_in": [],
                         "message": "No business here has a Meesho account connected."})
    with ThreadPoolExecutor(max_workers=min(8, len(accounts))) as pool:     # every business at once
        results = list(pool.map(lambda a: search_account(a, query), accounts))
    rank = {"found": 0, "similar": 1, "none": 2, "no_session": 3, "error": 3}
    results.sort(key=lambda r: (rank.get(r["state"], 9), r["business_name"]))
    return Response({"sku": query, "results": results,
                     "found_in": [r["business_name"] for r in results if r["state"] == "found"]})
