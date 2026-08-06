"""
The catalog of navigable areas of the app, and which API endpoints each one owns.

This module is the server-side source of truth for access control. The frontend
keeps its own NAV_GROUPS (it needs icons, routes and grouping for rendering), but
the paths must match the ones here — anything the server doesn't recognise is
rejected when an admin saves a rule, which is what keeps the two lists honest.

Why the API map matters: hiding a sidebar tab only hides a link. Without a
server-side check, a restricted user could still call the endpoint directly, so
"show this user only Labels" would be decoration rather than a restriction.
"""

# ── Navigable areas, in sidebar order ────────────────────────────────────────
# group is only used to lay the admin screen out in the same shape as the sidebar.
NAV_CATALOG = [
    {"path": "/",                  "label": "Overview",          "group": "Analytics"},
    {"path": "/sku-analysis",      "label": "SKU Analysis",      "group": "Analytics"},
    {"path": "/ads-analysis",      "label": "Ads Analysis",      "group": "Analytics"},
    {"path": "/estimated-profit",  "label": "Estimated Profit",  "group": "Analytics"},

    {"path": "/orders",            "label": "Orders",            "group": "Operations"},
    {"path": "/order-scan",        "label": "Order Scan",        "group": "Operations"},
    {"path": "/payments",          "label": "Payments",          "group": "Operations"},
    {"path": "/unscheduled",       "label": "Unscheduled Pay",   "group": "Operations"},
    {"path": "/unsettled",         "label": "Unsettled",         "group": "Operations"},
    {"path": "/mismatch",          "label": "Pay Mismatch",      "group": "Operations"},
    {"path": "/labels",            "label": "Labels",            "group": "Operations"},
    {"path": "/returns",           "label": "Returns & Claims",  "group": "Operations"},
    {"path": "/claims",            "label": "Claim Sheet",       "group": "Operations"},
    {"path": "/tasks",             "label": "Team Tasks",        "group": "Operations"},

    {"path": "/pricing",           "label": "SKU Pricing",       "group": "Catalog"},
    {"path": "/tax-check",         "label": "Tax Check",         "group": "Catalog"},
    {"path": "/gst",               "label": "GST",               "group": "Catalog"},
    {"path": "/inventory",         "label": "Inventory",         "group": "Catalog"},
    {"path": "/inventory-labels",  "label": "Labels & Barcodes", "group": "Catalog"},
    {"path": "/meesho-inventory",  "label": "Meesho Stock",      "group": "Catalog"},
    {"path": "/meesho-pricing",    "label": "Price Update",      "group": "Catalog"},
    {"path": "/purchases",         "label": "Purchases",         "group": "Catalog"},
    {"path": "/expenses",          "label": "Expenses",          "group": "Catalog"},

    {"path": "/upload",            "label": "Upload Data",       "group": "Tools"},
    {"path": "/product-photos",    "label": "AI Photos",         "group": "Tools"},
    {"path": "/extension",         "label": "Browser Extension", "group": "Tools"},
    {"path": "/fraud",             "label": "Fraud Watch",       "group": "Tools"},
    {"path": "/business-profile",  "label": "Business Profile",  "group": "Tools"},

    {"path": "/admin",             "label": "Admin Panel",       "group": "Administration"},
]

NAV_PATHS = [item["path"] for item in NAV_CATALOG]
NAV_PATH_SET = set(NAV_PATHS)
NAV_LABELS = {item["path"]: item["label"] for item in NAV_CATALOG}

# Never hidden from a super admin, so an over-restrictive rule can always be
# undone from the Admin Panel instead of needing a database edit.
ALWAYS_VISIBLE_PATHS = ["/admin"]


# ── API ownership ────────────────────────────────────────────────────────────
# (url prefix under /api/business/<id>/, nav paths that may use it).
#
# Access is granted when the user can see AT LEAST ONE owner, because several
# endpoints are legitimately shared — the Labels screen creates parent SKUs, for
# instance, so it needs the pricing endpoints too.
#
# Checked longest-prefix-first, so "inventory/labels/" wins over "inventory/".
# A prefix that isn't listed is always allowed: the general analytics reads
# (profit/, dashboard/, orders/, referrals/ …) are used by many screens at once,
# and guessing at ownership there would break working screens for the sake of
# hiding numbers the user's own tabs already show them.
API_OWNERSHIP = {
    "upload/":               ["/upload"],
    "upload-orders/":        ["/upload"],

    "labels/":               ["/labels"],
    "returns/":              ["/returns"],
    # The claim sheet writes back onto returns, so either screen may reach it.
    "claims/":               ["/claims", "/returns"],
    # The tasks screen is the one thing a worker account needs; the API enforces
    # per-user scoping on top, so granting it exposes only their own tasks.
    "worker-tasks/":         ["/tasks"],
    "wallet/":               ["/tasks"],
    "order-scan/":           ["/order-scan"],

    # The extension is the main consumer of these, and it authenticates as a real
    # user — so whoever may see the Extension page may sync templates.
    "listing-templates/":    ["/extension"],
    "gst/":                  ["/gst"],
    "expenses/":             ["/expenses"],
    "tax-check/":            ["/tax-check"],
    "estimated-profit/":     ["/estimated-profit"],
    "ads/":                  ["/ads-analysis", "/"],
    "product-photos/":       ["/product-photos"],

    "fraud-customers/":      ["/fraud"],
    "blocked-customers/":    ["/fraud", "/labels"],

    "purchases/":            ["/purchases"],
    "consumables/":          ["/purchases", "/expenses"],

    "inventory/labels/":     ["/inventory-labels"],
    "inventory/":            ["/inventory", "/inventory-labels"],

    "meesho-inventory/":     ["/meesho-inventory"],
    "meesho-price-update/":  ["/meesho-pricing", "/meesho-inventory"],

    # Pricing is shared: the Labels and Inventory screens both create and link
    # parent SKUs, and SKU Analysis reads the same rows.
    "final-prices/":         ["/pricing", "/labels", "/inventory", "/sku-analysis"],
    "parent-prices/":        ["/pricing", "/labels", "/inventory", "/sku-analysis"],
    "parent-from-sku/":      ["/pricing", "/labels", "/inventory"],
    "parent-linking/":       ["/pricing", "/labels", "/inventory"],
    "link-sku/":             ["/pricing", "/labels", "/inventory"],
    "pricing/":              ["/pricing"],
}

# Longest first so the most specific rule wins.
_ORDERED_OWNERSHIP = sorted(API_OWNERSHIP.items(), key=lambda kv: -len(kv[0]))


def owners_for_api_path(sub_path):
    """
    The nav paths that may call this API sub-path, or None when unguarded.

    `sub_path` is what follows /api/business/<id>/ — e.g. "labels/parse/".
    """
    s = (sub_path or "").lstrip("/")
    for prefix, owners in _ORDERED_OWNERSHIP:
        if s.startswith(prefix):
            return owners
    return None


def clean_paths(paths):
    """Keep only known nav paths, de-duplicated, in catalog order."""
    given = {p.strip() for p in paths or [] if isinstance(p, str) and p.strip()}
    return [p for p in NAV_PATHS if p in given]


def unknown_paths(paths):
    """The submitted paths that aren't in the catalog (for a clear 400)."""
    return sorted(
        {p.strip() for p in paths or [] if isinstance(p, str) and p.strip()} - NAV_PATH_SET
    )
