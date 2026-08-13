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

4. Rows aren't synthesised from a pasted list of photo links the way
   Meesho's flow does. Flipkart's own bulk image-upload tool already drops
   a generated SKU and its assigned images into each row before a seller
   downloads this file — `extract_prefilled_rows` reads those rows straight
   off the sheet, one dict per row, and that *is* the row list from then on.
   Consequently there's no cross-row image shuffle here at all (contrast
   bulk_listing.plan_images): a row's own images stay its own, in whatever
   order the caller (the UI, via drag-reordering) settles on — see
   `build_workbook`. And because attribute values can legitimately differ
   row to row (unlike Meesho's one-shared-form-for-every-row model), there's
   no `shared` dict either — every field's value comes from that row's own
   `attributes`.

Reuses bulk_listing.py's PER_ROW_ROLES / image_slots / coerce_cell — those
only ever look at `role`/`key`/`type` on the shared spec-dict shape, so
they're already platform-agnostic and don't need a Flipkart-specific copy.
"""

import re
from decimal import Decimal, InvalidOperation

import xlrd
from xlutils.copy import copy as _xlutils_copy

from .bulk_listing import PER_ROW_ROLES, coerce_cell, find_field, image_slots  # noqa: F401  (re-exported for callers)

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


# A field this business always fills the same way, so the seller never has
# to type it (and never accidentally types something else): "Shipping
# provider" only matters at all when "Fullfilment by" is "Seller" rather
# than Flipkart-fulfilled (per the template's own Summary Sheet), and this
# seller always ships through Flipkart's own network. "FLIPKART" matches
# the Shipping provider column's own row-2 example casing exactly — it's
# free text with no dropdown of its own to validate against, so getting
# the casing right here is the only guard there is. Keyed by label
# (lowercased) rather than by role, since this isn't a role this app
# otherwise recognises — matched purely by the column header text. Unlike
# DEFAULT_ATTRIBUTE_VALUES below, a forced field always wins, on every row,
# no matter what's already on the sheet or what the seller types.
FORCED_ATTRIBUTE_VALUES = {
    "shipping provider": "FLIPKART",
}

# A sane starting value for a field the seller can still freely change —
# unlike FORCED_ATTRIBUTE_VALUES, this only fills in where the sheet's own
# cell is blank, so it's shown (and editable) in the UI rather than hidden.
# "express" is this business's usual procurement lane.
DEFAULT_ATTRIBUTE_VALUES = {
    "procurement type": "express",
}


def forced_attributes(spec):
    """{field_key: forced_value} for every field on this spec that
    FORCED_ATTRIBUTE_VALUES pins down — merge this over whatever a row's
    own attributes say (these values always win) before validating or
    writing a row."""
    return {
        f["key"]: FORCED_ATTRIBUTE_VALUES[f["label"].strip().lower()]
        for f in spec["fields"]
        if f["label"].strip().lower() in FORCED_ATTRIBUTE_VALUES
    }


def default_attributes(spec):
    """{field_key: default_value} for every field DEFAULT_ATTRIBUTE_VALUES
    names — only meant to fill a blank, never to overwrite an existing
    value (see extract_prefilled_rows, the only caller)."""
    return {
        f["key"]: DEFAULT_ATTRIBUTE_VALUES[f["label"].strip().lower()]
        for f in spec["fields"]
        if f["label"].strip().lower() in DEFAULT_ATTRIBUTE_VALUES
    }


def _cell_text(ws, row, col):
    """xlrd hands back every numeric cell as a Python float — a whole-number
    MRP of 199 reads back as 199.0, which would show up in the UI as
    "199.0" if not corrected here."""
    value = ws.cell_value(row, col)
    if value in (None, ""):
        return ""
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    return str(value).strip()


# When a sheet already went to Flipkart and came back rejected, Flipkart
# writes the outcome straight into these same fixed system columns (see
# _SYSTEM_LABELS above) — never into a separate file. "Status" columns hold
# a short state word ("Failed", "Success", "Live", "Approved", …); "reason"
# columns hold the actual human-readable explanation. Both are excluded
# from `spec["fields"]` (they're Flipkart-written, never seller-editable),
# so reading them back needs the sheet's own header row again rather than
# anything already in `spec`.
_ERROR_STATUS_LABELS = ("catalog qc status", "product data status", "listing status")
_ERROR_REASON_LABELS = ("qc failed reason (if any)", "disapproval reason (if any)")
_OK_STATUS_VALUES = {"success", "active", "live", "approved", ""}


def _header_column_map(ws):
    """{lowercased header label: column index} for every column on row 0 —
    including the system-only ones parse_template deliberately leaves out
    of `spec["fields"]`, which is exactly what _row_error needs."""
    out = {}
    for c in range(ws.ncols):
        label = str(ws.cell_value(0, c)).strip().lower()
        if label:
            out.setdefault(label, c)
    return out


def _row_error(ws, r, header_cols):
    """
    `{"status": ..., "message": ...}` if this row shows a real rejection —
    a status column reading something other than a success-like word, or a
    non-blank reason column — else None for an untouched or accepted row.
    `message` may contain multiple `\\n`-separated lines: Flipkart's own
    "QC Failed Reason" cell already numbers each individual failure that
    way (see extract_prefilled_rows' module-level docstring for a real
    example), so this is passed straight through rather than re-split.
    """
    status = None
    for label in _ERROR_STATUS_LABELS:
        col = header_cols.get(label)
        if col is None:
            continue
        value = _cell_text(ws, r, col)
        if value and value.strip().lower() not in _OK_STATUS_VALUES:
            status = value
            break
    messages = []
    for label in _ERROR_REASON_LABELS:
        col = header_cols.get(label)
        if col is None:
            continue
        value = _cell_text(ws, r, col)
        if value:
            messages.append(value)
    if status is None and not messages:
        return None
    return {"status": status, "message": "\n".join(messages) if messages else None}


def extract_prefilled_rows(spec, rb):
    """
    One listing per row already sitting in the uploaded sheet — Flipkart's
    own bulk image-upload tool drops a generated SKU and its assigned
    images (Main + Other 1-4) into a row before a seller downloads this
    file, so unlike Meesho there is no "paste your links" step at all: the
    rows to build listings from are already on the sheet. Reads straight
    down from `data_start_row`, one dict per row (`sku_id`, `images` — the
    row's own image URLs in slot order, exactly as found, no shuffling),
    stopping at the first row with a blank SKU cell.

    Also reads every other attribute field's own cell, not just SKU and
    images — a sheet that already has some product details filled in (MRP,
    Brand, Color, …) on some or all rows carries those straight into the
    form as each row's starting point, so re-editing an already-filled
    sheet only touches whatever's actually being changed, rather than
    starting every row from a blank form. `attributes` on the returned dict
    holds whatever came out of that: a field's own default (see
    DEFAULT_ATTRIBUTE_VALUES) only fills a genuinely blank cell; a forced
    field (see FORCED_ATTRIBUTE_VALUES) always wins over both.

    A row also carries an `"error"` key — `{"status", "message"}` — when
    this sheet is one Flipkart already rejected: e.g. a real rejection seen
    while building this feature read (verbatim, in the sheet's own "QC
    Failed Reason" cell) `"4 error(s) found\\n1. ...\\n2. Fulfilled by
    Flipkart is not available for this product.\\n3. [procurement_type]:
    Procurement Type is not allowed to be updated.\\n4. [shipping_days]:
    Procurement SLA is not allowed to be updated."` — Flipkart had that
    listing set to Flipkart-fulfilled, which locks Procurement
    Type/SLA/Shipping Provider/Stock from being touched by a bulk upload at
    all, regardless of what value they're set to. `"error"` is absent
    entirely on a row with nothing to report, so callers can just check
    `row.get("error")` rather than a magic empty value.
    """
    sku_field = find_field(spec, role="sku")
    if not sku_field:
        return []
    ws = rb.sheet_by_name(spec["sheet_name"])
    slot_fields = [f for role in image_slots(spec) for f in spec["fields"] if f["role"] == role]
    attribute_fields = [f for f in spec["fields"] if f["role"] not in PER_ROW_ROLES]
    defaults = default_attributes(spec)
    forced = forced_attributes(spec)
    header_cols = _header_column_map(ws)

    rows = []
    r = spec["data_start_row"]
    while r < ws.nrows:
        sku = _cell_text(ws, r, sku_field["column"])
        if not sku:
            break
        images = [_cell_text(ws, r, f["column"]) for f in slot_fields]
        attributes = {}
        for f in attribute_fields:
            text = _cell_text(ws, r, f["column"])
            if text:
                attributes[f["key"]] = text
        for key, value in defaults.items():
            attributes.setdefault(key, value)
        attributes.update(forced)
        row = {"sku_id": sku, "images": images, "attributes": attributes}
        error = _row_error(ws, r, header_cols)
        if error:
            row["error"] = error
        rows.append(row)
        r += 1
    return rows


def build_workbook(spec, rb, rows):
    """
    `rb`: the `xlrd.Book` from `load_workbook`/`parse_template` — `.xls`
    can't be mutated in place, so this makes a fresh writable copy (via
    `xlutils.copy`) rather than mutating `rb` itself, and returns *that*.

    No `shared` dict, unlike bulk_listing.build_workbook: Flipkart has no
    "same value on every row" concept in this flow — a row's attributes are
    only ever the values entered for *that* row (optionally copied in from
    another row client-side first, but that's the caller's business, not
    this function's). `rows` are dicts of `sku_id`, `images` (ordered list,
    one URL per image slot — this row's own, in whatever order the caller
    settled on), `attributes` (field key -> value, this row's own).
    """
    wb = _xlutils_copy(rb)
    ws = wb.get_sheet(spec["sheet_name"])
    sku_field = find_field(spec, role="sku")
    slot_fields = [f for role in image_slots(spec) for f in spec["fields"] if f["role"] == role]
    attribute_fields = {f["key"]: f for f in spec["fields"] if f["role"] not in PER_ROW_ROLES}

    for i, row in enumerate(rows):
        r = spec["data_start_row"] + i
        if sku_field:
            ws.write(r, sku_field["column"], row["sku_id"])
        for f, url in zip(slot_fields, row["images"]):
            if url:
                ws.write(r, f["column"], url)
        attrs = row.get("attributes") or {}
        for key, value in attrs.items():
            f = attribute_fields.get(key)
            if f and value not in (None, ""):
                ws.write(r, f["column"], coerce_cell(f, value))

    return wb
