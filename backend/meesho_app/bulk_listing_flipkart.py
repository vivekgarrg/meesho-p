"""
Bulk listing sheet generation for Flipkart — the same idea as
bulk_listing.py (parse whatever category template you're given, derive the
form's fields from it, build the output from the template rather than a
hand-rolled one), but for Flipkart's own template format, which is a
different animal from Meesho's in three ways:

1. It's a genuine legacy binary `.xls` (BIFF8 / Composite Document V2), not
   `.xlsx` — `openpyxl` can't touch it at all. Reading uses `xlrd` (which
   still supports `.xls` in its 2.0+ line, having dropped `.xlsx` support
   the other direction); writing uses `xlutils.copy` to turn the read-only
   `xlrd.Book` into an editable `xlwt.Workbook` that keeps every other
   sheet and the header formatting intact — the closest equivalent to
   openpyxl's load-mutate-save round trip, just via a different pair of
   libraries, and round-tripped and confirmed against a real file.

2. `.xls` carries no data-validation objects `xlrd` can read, so there's no
   equivalent of reading `DataValidation.formula1` the way the Meesho
   parser does. Flipkart's template instead documents everything in plain
   rows and cell colour (confirmed against the template's own "Summary
   Sheet" instructions, and cross-checked against real cells):
     row 0 = field label, row 1 = a type hint ("Single - Positive_integer",
     "MULTI - TEXT…", "URL", "Dropdown"…), row 2 = example, row 3 =
     description, data starts at row 4. A header cell's *fill colour* marks
     it grey (Flipkart-only, skip), blue (mandatory), purple ("conditionally
     mandatory" — treated as optional here; the condition isn't reliably
     derivable from the file, and blocking generation on a guess would be
     worse than not enforcing it), or green (ordinary optional field).
     Dropdown option lists live in sheets named `DropDownValuesForColumn{N}`
     — N is the exact 0-indexed column number in the category sheet — with
     a handful of exceptions (Color, Material, Regional Speciality on the
     file this was built against) whose list is a labelled column in the
     `Index` sheet instead.

3. There is no "Product Name" / title column at all on Flipkart — titles
   aren't a field sellers fill in. So a Flipkart spec never has a `"title"`
   role; callers (bulk_listing_views.py) already treat that as optional.

Reuses bulk_listing.py's PER_ROW_ROLES / image_slots / coerce_cell — those
only ever look at `role`/`key`/`type` on the shared spec-dict shape, so
they're already platform-agnostic and don't need a Flipkart-specific copy.
"""

import re
from decimal import Decimal, InvalidOperation

import xlrd
from xlutils.copy import copy as _xlutils_copy

from .bulk_listing import PER_ROW_ROLES, coerce_cell, image_slots  # noqa: F401  (re-exported for callers)

# Universal across every Flipkart category template — Flipkart's own system
# columns, never seller-editable no matter what colour the sheet paints them.
_SYSTEM_LABELS = {
    "flipkart serial number", "catalog qc status", "qc failed reason (if any)",
    "product data status", "disapproval reason (if any)", "listing status",
}

_SYSTEM_SHEET_PREFIXES = (
    "summary sheet", "index", "listing faq sheet", "image guideline",
    "matchingattributes", "variantattributes", "parent variant products",
    "template_version",
)

_GREY_BG = (192, 192, 192)   # Flipkart-only
_BLUE_BG = (141, 180, 226)   # mandatory
# purple (204, 153, 255) "conditionally mandatory" and green (148, 208, 80)
# "ordinary optional" are both just "not required" here — see module docstring.

_TYPE_HINT_NUMBER = re.compile(r"positive_integer|non_negative_integer|number|decimal", re.I)
_TYPE_HINT_TEXTAREA = re.compile(r"long_text|multi\s*-", re.I)
_TYPE_HINT_BOOLEAN = re.compile(r"boolean", re.I)

DATA_START_ROW = 4  # rows 0-3 are label/type/example/description


def load_workbook(source):
    """
    `source`: a path (str/Path) or a file-like object.

    Returns an `xlrd.Book` (read-only — `build_workbook` makes the writable
    copy). Raises ValueError, not xlrd's own exception types, so callers can
    turn a bad upload straight into a 400 without knowing xlrd's API.
    """
    try:
        if hasattr(source, "read"):
            return xlrd.open_workbook(file_contents=source.read(), formatting_info=True)
        return xlrd.open_workbook(str(source), formatting_info=True)
    except Exception as exc:
        raise ValueError(f"Could not read that as a legacy Excel (.xls) file: {exc}") from exc


def _is_system_sheet(name):
    lower = name.lower()
    return lower.startswith(_SYSTEM_SHEET_PREFIXES) or lower.startswith("dropdownvaluesforcolumn")


def _detect_category_sheet(rb):
    """The widest sheet that isn't one of Flipkart's fixed utility sheets —
    the category (attribute) sheet is named after the category itself
    ("kalash"), not anything generic, so "richest sheet wins" (by column
    count, since .xls carries no validation objects to count the way the
    Meesho parser counts them) is what actually finds it."""
    best, best_width = None, -1
    for name in rb.sheet_names():
        if _is_system_sheet(name):
            continue
        ws = rb.sheet_by_name(name)
        if ws.ncols > best_width:
            best, best_width = name, ws.ncols
    if best is None:
        raise ValueError("Could not find this template's category sheet.")
    return best


def _cell_bg(rb, ws, row, col):
    xf = rb.xf_list[ws.cell(row, col).xf_index]
    return rb.colour_map.get(xf.background.pattern_colour_index)


def _field_key(label, seen):
    base = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "field"
    n = seen.get(base, 0)
    seen[base] = n + 1
    return base if n == 0 else f"{base}_{n + 1}"


def _detect_role(label):
    l = label.lower().strip()
    if l == "seller sku id":
        return "sku"
    if l == "main image url":
        return "image_1"
    m = re.match(r"other image url (\d+)", l)
    if m:
        return f"image_{int(m.group(1)) + 1}"
    return None


def _field_type(hint, has_options):
    if has_options or _TYPE_HINT_BOOLEAN.search(hint or ""):
        return "select"
    if _TYPE_HINT_TEXTAREA.search(hint or ""):
        return "textarea"
    if _TYPE_HINT_NUMBER.search(hint or ""):
        return "number"
    return "text"


def _resolve_options(rb, col_index, label, hint):
    """
    `hint` is the field's own row-1 type text — it gates which source is
    trusted. `DropDownValuesForColumn{index}` sheets are keyed purely by
    column *position*, and on the real file this was built against, one
    column's sheet held a completely unrelated list (a "Multi - Text" field,
    "Items Included", pointed at a sheet actually meant for a different,
    single-select field) — Flipkart's own template export, not something
    programmatically detectable except by noticing it doesn't fit the
    field's own declared shape. "Multi" fields are genuinely meant to be
    free-typed `::`-separated lists per Flipkart's own documented
    convention anyway, so they skip the column-index sheet and only trust
    the Index-sheet fallback below, which is matched by *label*, not
    position, and so isn't vulnerable to the same mismatch.
    """
    if not hint.strip().lower().startswith("multi"):
        dv_name = f"DropDownValuesForColumn{col_index}"
        if dv_name in rb.sheet_names():
            ws = rb.sheet_by_name(dv_name)
            values = [
                str(ws.cell_value(r, 0)).strip()
                for r in range(ws.nrows)
                if str(ws.cell_value(r, 0)).strip()
            ]
            if values:
                return values
    # Fallback: a handful of fields (Color, Material, Regional Speciality on
    # the file this was built against) have their list as a labelled column
    # in the Index sheet instead of their own DropDownValuesForColumn sheet.
    if "Index" in rb.sheet_names():
        idx = rb.sheet_by_name("Index")
        target = label.strip().lower()
        for r in range(min(idx.nrows, 5)):
            for c in range(idx.ncols):
                header = str(idx.cell_value(r, c)).strip().lower()
                if header and header == target:
                    values = []
                    for rr in range(r + 1, idx.nrows):
                        v = str(idx.cell_value(rr, c)).strip()
                        if not v:
                            break
                        values.append(v)
                    if values:
                        return values
    return []


def parse_template(rb):
    """
    Returns the same spec shape bulk_listing.parse_template does:
    `{category_label, sheet_name, data_start_row, fields: [...]}`, each
    field `{key, label, column, required, type, options, role,
    mirror_columns: [], money_max: None}` — `column` is a 0-indexed int
    here rather than a letter (this module's own `build_workbook` is the
    only thing that needs to know that; `find_field`/`image_slots`/
    `PER_ROW_ROLES` only ever look at `role`/`key`).
    """
    sheet_name = _detect_category_sheet(rb)
    ws = rb.sheet_by_name(sheet_name)

    fields = []
    seen_keys = {}
    for col in range(ws.ncols):
        label = str(ws.cell_value(0, col)).strip()
        if not label or label.lower() in _SYSTEM_LABELS:
            continue
        if _cell_bg(rb, ws, 0, col) == _GREY_BG:
            continue
        hint = str(ws.cell_value(1, col)).strip()
        options = _resolve_options(rb, col, label, hint)
        if not options and _TYPE_HINT_BOOLEAN.search(hint):
            options = ["Yes", "No"]
        fields.append({
            "key": _field_key(label, seen_keys),
            "label": label,
            "column": col,
            "required": _cell_bg(rb, ws, 0, col) == _BLUE_BG,
            "type": _field_type(hint, bool(options)),
            "options": options,
            "role": _detect_role(label),
            "mirror_columns": [],
            "money_max": None,
        })

    return {
        "category_label": sheet_name,
        "sheet_name": sheet_name,
        "data_start_row": DATA_START_ROW,
        "fields": fields,
    }


def build_workbook(spec, rb, shared, rows):
    """
    `rb`: the `xlrd.Book` from `load_workbook`/`parse_template` — `.xls`
    can't be mutated in place, so this makes a fresh writable copy (via
    `xlutils.copy`) rather than mutating `rb` itself, and returns *that*.
    Callers must save the return value, not `rb` — mirrors
    bulk_listing.build_workbook's contract otherwise: `rows` are dicts of
    `sku_id`, `images` (ordered list, one URL per image slot), and
    optionally `product_name`/`style_id`/`group_id` — harmlessly ignored
    here since Flipkart has none of those roles.
    """
    wb = _xlutils_copy(rb)
    ws = wb.get_sheet(spec["sheet_name"])
    per_row_fields = {f["role"]: f for f in spec["fields"] if f["role"] in PER_ROW_ROLES}
    shared_fields = [f for f in spec["fields"] if f["role"] not in PER_ROW_ROLES]
    slots = image_slots(spec)

    for i, row in enumerate(rows):
        r = spec["data_start_row"] + i

        if "sku" in per_row_fields:
            ws.write(r, per_row_fields["sku"]["column"], row["sku_id"])
        if "title" in per_row_fields and row.get("product_name"):
            ws.write(r, per_row_fields["title"]["column"], row["product_name"])
        if "style" in per_row_fields and row.get("style_id"):
            ws.write(r, per_row_fields["style"]["column"], row["style_id"])
        if "group_id" in per_row_fields and row.get("group_id"):
            ws.write(r, per_row_fields["group_id"]["column"], row["group_id"])

        for slot, url in zip(slots, row["images"]):
            if slot in per_row_fields and url:
                ws.write(r, per_row_fields[slot]["column"], url)

        for f in shared_fields:
            value = shared.get(f["key"])
            if value not in (None, ""):
                ws.write(r, f["column"], coerce_cell(f, value))

    return wb
