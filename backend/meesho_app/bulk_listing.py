"""
Bulk listing sheet generation — turns one filled-in product form into a
ready-to-upload Meesho bulk-listing `.xlsx`, built from Meesho's own category
template rather than a hand-rolled one, so every dropdown/validation Meesho's
importer enforces is already satisfied.

Nothing about a template is hardcoded per category: `parse_template()` reads
whatever `.xlsx` it's given (an upload, or the one bundled "quick start" file)
and derives the field list itself — see the module docstring on
`parse_template` for exactly what it relies on. That's what lets the same
code serve any Meesho category, not just the one example we started from.
"""

import random
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

import openpyxl

TEMPLATES_DIR = Path(__file__).resolve().parent / "bulk_listing_templates"

# Bundled "quick start" templates — go through the exact same parser as an
# upload, they just don't require picking a file first.
BUILT_IN_TEMPLATES = {
    "puja_articles": {
        "label": "Puja Articles (Home & Kitchen / Home Decor / Puja Accessories)",
        "file": TEMPLATES_DIR / "puja_articles.xlsx",
    },
}

ROWS_PER_SHEET = 4

# Which detected roles are per-row (varying) rather than shared across all 4
# rows. Everything else on the sheet — including fields we still recognise by
# role, like Country of Origin — is shared.
_FIXED_PER_ROW_ROLES = {"title", "sku", "style"}
_IMAGE_ROLE = re.compile(r"^image_(\d+)$")


class _PerRowRoles:
    """
    The roles that differ from one listing to the next.

    A plain set no longer works: categories carry however many image columns
    they carry — some have four, some fifteen — so image roles are matched by
    shape rather than listed. Kept callable as `role in PER_ROW_ROLES` because
    that is how every caller already reads.
    """

    def __contains__(self, role):
        return role in _FIXED_PER_ROW_ROLES or bool(role and _IMAGE_ROLE.match(role))

    def __iter__(self):
        return iter(_FIXED_PER_ROW_ROLES)


PER_ROW_ROLES = _PerRowRoles()

_RANGE_RE = re.compile(r"^(?:'([^']+)'|([A-Za-z0-9_]+))!\$?([A-Z]+)\$(\d+):\$?([A-Z]+)\$(\d+)$")
_SQREF_START_RE = re.compile(r"^([A-Z]+)(\d+)")


def category_choices():
    return [{"id": key, "label": cfg["label"]} for key, cfg in BUILT_IN_TEMPLATES.items()]


def built_in_path(key):
    cfg = BUILT_IN_TEMPLATES.get(key)
    if not cfg:
        raise KeyError(key)
    return cfg["file"]


def _detect_fill_sheet(wb):
    """The sheet actually meant to be filled in — prefer one named like
    "...-Fill this" (Meesho's own convention); else whichever sheet carries
    the most data validations (the fill sheet is always the heavily-
    constrained one); else just the first sheet."""
    for name in wb.sheetnames:
        if "fill" in name.lower():
            return name
    best, best_count = wb.sheetnames[0], -1
    for name in wb.sheetnames:
        n = len(wb[name].data_validations.dataValidation)
        if n > best_count:
            best, best_count = name, n
    return best


def _first_nonempty(ws, row):
    for ci in range(1, ws.max_column + 1):
        v = ws.cell(row=row, column=ci).value
        if v not in (None, ""):
            return str(v).strip()
    return None


def _sqref_start(dv):
    first_range = str(dv.sqref).split()[0]
    m = _SQREF_START_RE.match(first_range)
    if not m:
        return None, None
    return m.group(1), int(m.group(2))


def _column_validations(wb, ws):
    """
    {column_letter: {"options": [...] or None, "start_row": int or None}} —
    `start_row` is the first row that column's own validation applies to
    (used to find where real data starts without hardcoding a row number),
    `options` is the resolved dropdown list for list-type validations, read
    from wherever the validation's own formula actually points (not
    hand-transcribed, so it can't drift from what the file really allows).
    """
    out = {}
    for dv in ws.data_validations.dataValidation:
        col, row = _sqref_start(dv)
        if not col:
            continue
        entry = out.setdefault(col, {"options": None, "start_row": None})
        if row is not None and (entry["start_row"] is None or row < entry["start_row"]):
            entry["start_row"] = row
        if dv.type == "list" and entry["options"] is None and dv.formula1:
            raw = dv.formula1.strip()
            m = _RANGE_RE.match(raw)
            if m:
                src_sheet = m.group(1) or m.group(2)
                src_col, r1, r2 = m.group(3), int(m.group(4)), int(m.group(6))
                src_ws = wb[src_sheet] if src_sheet in wb.sheetnames else ws
                ci = openpyxl.utils.column_index_from_string(src_col)
                values = [
                    str(src_ws.cell(row=r, column=ci).value)
                    for r in range(r1, r2 + 1)
                    if src_ws.cell(row=r, column=ci).value not in (None, "")
                ]
                entry["options"] = values
            elif raw.startswith('"') and raw.endswith('"'):
                # An inline list ("A,B,C") rather than a range reference.
                entry["options"] = [v.strip() for v in raw[1:-1].split(",") if v.strip()]
    return out


def _parse_label(cell_text):
    """
    Meesho's own field-name row packs the short label and a long description
    into one cell as `"\\n\\n<Field Name>\\n\\n<description>\\n"` — the first
    non-blank line, once split on blank lines, is the label.
    """
    if not cell_text:
        return ""
    parts = [p.strip() for p in str(cell_text).split("\n\n") if p.strip()]
    return parts[0] if parts else str(cell_text).strip()


def _field_key(label, seen):
    base = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "field"
    n = seen.get(base, 0)
    seen[base] = n + 1
    return base if n == 0 else f"{base}_{n + 1}"


_NUMBER_HINT = re.compile(
    r"price|mrp|weight|quantity|breadth|height|length|inventory|gst|%", re.I
)
_TEXTAREA_HINT = re.compile(r"description|address", re.I)


def _detect_role(label):
    l = label.lower()
    if l.startswith("product name"):
        return "title"
    if l == "sku id" or l.startswith("sku id"):
        return "sku"
    if "style id" in l or "product id" in l:
        return "style"
    # Any image column, however many the category has — "Image 1 (Front)",
    # "Image 2" … "Image 17". Capped at 1-4 before, which silently ignored
    # every slot past the fourth.
    m = re.match(r"image\s*(\d+)", l)
    if m:
        return f"image_{int(m.group(1))}"
    if "wrong" in l and "defective" in l:
        return "wrong_defective_price"
    if l.startswith("country of origin"):
        return "country_of_origin"
    if l.startswith("importer name"):
        return "importer_name"
    if l.startswith("importer address"):
        return "importer_address"
    if l.startswith("importer pincode"):
        return "importer_pincode"
    return None


def _field_type(label, has_options):
    if has_options:
        return "select"
    if _TEXTAREA_HINT.search(label):
        return "textarea"
    if _NUMBER_HINT.search(label):
        return "number"
    return "text"


def load_workbook(source):
    """`source`: a path (str/Path) or a file-like object positioned at 0.
    Raises ValueError (not openpyxl's own exception types) so callers can
    turn a bad upload straight into a 400 without knowing openpyxl's API."""
    try:
        return openpyxl.load_workbook(source, data_only=False)
    except Exception as exc:
        raise ValueError(f"Could not read that as an Excel file: {exc}") from exc


def parse_template(source):
    """
    `source`: an already-loaded `openpyxl.Workbook` (see `load_workbook`
    below) — callers that also need to *write* into the same file (i.e.
    `generate`) load it once and pass the same object to both, rather than
    reading the upload twice.

    Returns `{category_label, sheet_name, data_start_row, fields: [...]}`.
    Each field is `{key, label, column, required, type, options, role}` —
    `role` is one of PER_ROW_ROLES, a handful of other recognised shared
    roles (see `_detect_role`), or None for an ordinary shared field.

    Raises ValueError if `source` doesn't look like a Meesho bulk template
    (no per-column data validation found on the detected sheet at all).
    """
    wb = source
    sheet_name = _detect_fill_sheet(wb)
    ws = wb[sheet_name]
    category_label = _first_nonempty(ws, row=1) or sheet_name

    col_validations = _column_validations(wb, ws)
    if not col_validations:
        raise ValueError(
            "This doesn't look like a Meesho bulk-listing template — no per-column "
            "validation found on its fill-in sheet."
        )

    data_start_row = min(
        (info["start_row"] for info in col_validations.values() if info["start_row"]),
        default=5,
    )

    fields = []
    seen_keys = {}
    for ci in range(1, ws.max_column + 1):
        col = openpyxl.utils.get_column_letter(ci)
        row2 = str(ws.cell(row=2, column=ci).value or "").lower()
        # Only columns Meesho itself marks as a real field ("* Compulsory
        # Field" / "Optional Field") are fillable — this is what actually
        # excludes the "Field Names" header column and the "Meesho only,
        # don't fill" error-status columns, which otherwise still carry
        # descriptive text in row 3 and would slip through a label-only check.
        if "compulsory" not in row2 and "optional" not in row2:
            continue
        required = "compulsory" in row2
        label = _parse_label(ws.cell(row=3, column=ci).value) or f"Column {col}"
        info = col_validations.get(col, {})
        options = info.get("options") or []
        fields.append({
            "key": _field_key(label, seen_keys),
            "label": label,
            "column": col,
            "required": required,
            "type": _field_type(label, bool(options)),
            "options": options,
            "role": _detect_role(label),
        })

    return {
        "category_label": category_label,
        "sheet_name": sheet_name,
        "data_start_row": data_start_row,
        "fields": fields,
    }


def find_field(spec, role=None, key=None):
    for f in spec["fields"]:
        if role is not None and f["role"] == role:
            return f
        if key is not None and f["key"] == key:
            return f
    return None


def image_slots(spec):
    """The template's image columns, in slot order (Image 1, 2, 3 … N)."""
    slots = []
    for f in spec["fields"]:
        m = _IMAGE_ROLE.match(f["role"] or "")
        if m:
            slots.append((int(m.group(1)), f["role"]))
    return [role for _, role in sorted(slots)]


def plan_images(urls, slot_count, row_count, rng=None):
    """
    Decide which link goes in which image slot, for each listing.

    The front image is the product's hero shot, so it is the same on every
    listing — swapping it around would change what a shopper sees first. The
    remaining photos are shuffled independently per row, so the listings are
    not four identical galleries while every one of them still leads with the
    right picture.

    Fewer links than slots simply leaves the spare slots empty; more links than
    slots means each row shows a different subset, which is the useful
    behaviour when a seller pastes fifteen photos into a four-image category.
    """
    rng = rng or random.Random()
    if not urls:
        return [[] for _ in range(row_count)]

    front, rest = urls[0], list(urls[1:])
    plans = []
    for _ in range(row_count):
        shuffled = rest[:]
        rng.shuffle(shuffled)
        plans.append([front, *shuffled][:slot_count])
    return plans


def resolve_wrong_defective_price(meesho_price, override):
    if override not in (None, ""):
        return override
    try:
        price = Decimal(str(meesho_price))
    except Exception:
        return ""
    return max(price - 20, Decimal("0"))


def resolve_importer_fields(country, name, address, pincode):
    """Mirrors Meesho's own template formula:
    `=IF(country="India","Not Required","")`."""
    if (country or "").strip().lower() == "india":
        return "Not Required", "Not Required", "Not Required"
    return name, address, pincode


_LEADING_ZERO = re.compile(r"^0\d")


def coerce_cell(field, value):
    """
    Turn a submitted value into what the cell should actually hold.

    Everything arrives from JSON as a string, and writing "499" into a price
    cell puts *text* there: Excel left-aligns it, flags "number stored as
    text", and the validation formulas Meesho ships inside the template do not
    read it as a value at all. That is why prices looked like they were not
    filling in — they were being written, just not as numbers.

    Leading zeros stay text on purpose. A code that happens to be numeric — an
    HSN, a pincode — stops meaning anything the moment 003924 becomes 3924.
    """
    if field.get("type") != "number":
        return value
    text = str(value).strip()
    if not text or _LEADING_ZERO.match(text):
        return value
    try:
        number = Decimal(text)
    except (InvalidOperation, ValueError):
        return value                      # let the sheet keep whatever was typed
    # Whole numbers as int so the cell reads "499", not "499.0".
    return int(number) if number == number.to_integral_value() else float(number)


def build_workbook(spec, wb, shared, rows):
    """
    Writes `rows` (ROWS_PER_SHEET dicts: `product_name`, `sku_id`,
    `style_id`, `images` = an ordered list, one URL per image slot) into the
    parsed sheet starting
    at `spec["data_start_row"]`, and every key in `shared` onto every row via
    the matching field's column. Everything else in the workbook — every
    other sheet, every other cell — is untouched.
    """
    ws = wb[spec["sheet_name"]]
    per_row_fields = {f["role"]: f for f in spec["fields"] if f["role"] in PER_ROW_ROLES}
    shared_fields = [f for f in spec["fields"] if f["role"] not in PER_ROW_ROLES]

    for i, row in enumerate(rows):
        r = spec["data_start_row"] + i

        if "title" in per_row_fields:
            ws[f'{per_row_fields["title"]["column"]}{r}'] = row["product_name"]
        if "sku" in per_row_fields:
            ws[f'{per_row_fields["sku"]["column"]}{r}'] = row["sku_id"]
        if "style" in per_row_fields:
            ws[f'{per_row_fields["style"]["column"]}{r}'] = row["style_id"]

        for slot, url in zip(image_slots(spec), row["images"]):
            if slot in per_row_fields and url:
                ws[f'{per_row_fields[slot]["column"]}{r}'] = url

        for f in shared_fields:
            value = shared.get(f["key"])
            if value not in (None, ""):
                ws[f'{f["column"]}{r}'] = coerce_cell(f, value)

    return wb
