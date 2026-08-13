"""
Bulk listing sheet generator — endpoints for BulkListingTab.jsx.

Fully stateless with respect to the template itself, with one exception:
nothing about an uploaded `.xlsx`/`.xls` is stored server-side by default —
the browser hangs onto the `File` (or a `built_in=` key for the bundled
Meesho quick-start template) and resends it on both `parse` (to get the
field list to render a form from) and `generate` (to actually build the
output). See bulk_listing.py's module docstring for why. The exception is
Flipkart's `template_id=` — a previously-saved FlipkartBulkTemplate, kept so
a seller doesn't have to re-upload the same category's file on every batch
(Flipkart has no bundled built-in the way Meesho does — see
FlipkartBulkTemplate's model docstring). Two other things persist for the
same "don't retype it every time" reason and have nothing to do with the
template file itself: a saved preset's field VALUES (BulkListingFieldPreset,
Meesho only) and the saved templates themselves (FlipkartBulkTemplate).
"""

import json
import re
from io import BytesIO

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from . import bulk_listing as bl
from . import bulk_listing_flipkart as blf
from .models import BulkListingFieldPreset, FinalPrice, FlipkartBulkTemplate, TaskListing
from .permissions import get_authorized_business
from .serializers import BulkListingFieldPresetSerializer, FlipkartBulkTemplateSerializer
from .views import _sku_key, _workbook_from_upload, safe_decimal

# Each module exposes the same contract — load_workbook/parse_template/
# build_workbook returning the same spec-dict shape — so everything below
# this point (validation, uniqueness checks, shared-field handling) is
# written once and works for either platform. Only *loading* a template
# (openpyxl vs xlrd — see bulk_listing_flipkart's module docstring for why
# Flipkart needs an entirely different pair of libraries) and *saving* the
# result (.xlsx vs legacy .xls) differ per platform.
_PLATFORM_MODULES = {"meesho": bl, "flipkart": blf}


def _resolve_platform(request):
    platform = str(request.data.get("platform") or "meesho").strip().lower()
    module = _PLATFORM_MODULES.get(platform)
    if not module:
        raise ValueError(f"Unknown platform '{platform}'.")
    return platform, module


def _resolve_source(request, module, platform, business):
    """
    The template to use for this request: whatever file was uploaded, a
    previously-saved Flipkart template (`template_id=`), or (Meesho only —
    Flipkart's field set is too category-specific for one bundled example
    to generalize) the built-in one the caller named.

    Returns `(workbook, original_filename)` — `workbook` in whatever shape
    `module.load_workbook` returns, `original_filename` the name to reuse
    verbatim for the generated download (None for a built-in, which has no
    "original" filename of its own — the caller falls back to a slug in
    that case). Raises ValueError (bad file / unknown template) / KeyError
    (unknown built_in) for the view to turn into a 400.
    """
    uploaded = request.FILES.get("file")
    built_in = str(request.data.get("built_in") or "").strip()
    template_id = str(request.data.get("template_id") or "").strip()
    if uploaded:
        source, _extracted = _workbook_from_upload(uploaded)
        return module.load_workbook(source), uploaded.name
    if template_id:
        if platform != "flipkart":
            raise ValueError("Saved templates are a Flipkart-only feature.")
        try:
            template = FlipkartBulkTemplate.objects.get(pk=template_id, business=business)
        except (FlipkartBulkTemplate.DoesNotExist, ValueError):
            raise ValueError("That saved template no longer exists.")
        return module.load_workbook(BytesIO(bytes(template.file_data))), template.original_filename
    if built_in:
        if platform != "meesho":
            raise ValueError("This platform has no built-in template — upload one.")
        return module.load_workbook(module.built_in_path(built_in)), None
    raise ValueError("Upload a template file, pick a built-in one, or pick a saved template.")


@api_view(["GET"])
def bulk_listing_built_ins(request, business_id):
    get_authorized_business(request, business_id)
    return Response({"results": bl.category_choices()})


@api_view(["POST"])
@parser_classes([MultiPartParser])
def bulk_listing_parse(request, business_id):
    business = get_authorized_business(request, business_id)
    try:
        platform, module = _resolve_platform(request)
        wb, _original_filename = _resolve_source(request, module, platform, business)
        spec = module.parse_template(wb)
    except KeyError:
        return Response({"error": "Unknown built-in template."}, status=status.HTTP_400_BAD_REQUEST)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    if not bl.find_field(spec, role="sku"):
        return Response(
            {"error": "Could not find a SKU ID column in this template."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    prefilled_rows = blf.extract_prefilled_rows(spec, wb) if platform == "flipkart" else []
    if platform == "flipkart" and not prefilled_rows:
        return Response(
            {"error": "No product rows found in this sheet — upload a Flipkart template that "
                      "already has each row's Seller SKU ID and images filled in (e.g. straight "
                      "after using Flipkart's own bulk image upload tool)."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response({
        "platform": platform,
        "category_label": spec["category_label"],
        "fields": [
            {k: v for k, v in f.items() if k not in ("column", "mirror_columns")}
            for f in spec["fields"]
        ],
        # Photos already sitting in this sheet's own data rows, one per row —
        # empty for a genuinely blank template. This is what the "Prefilled
        # Sheet" flow in the UI builds its listings from.
        "prefilled_images": bl.extract_front_images(spec, wb) if platform == "meesho" else [],
        # Flipkart's whole flow: one dict per row — `sku_id`, `images`,
        # `attributes` (whatever the sheet's own cells already held), and
        # `error` (present only on a row Flipkart already rejected) — read
        # straight off the uploaded sheet. See extract_prefilled_rows.
        "prefilled_rows": prefilled_rows,
    })


def _existing_sku_clash(business, sku_ids):
    """Which of these SKU ids (case-insensitively) are already used in this
    business's catalogue — priced (FinalPrice) or already listed via a team
    task (TaskListing) — so a generated sheet can't silently collide."""
    wanted = {_sku_key(s) for s in sku_ids}
    clashes = set()
    for sku in FinalPrice.objects.filter(business=business).values_list("sku_id", flat=True):
        if _sku_key(sku) in wanted:
            clashes.add(sku)
    for sku in TaskListing.objects.filter(business=business).values_list("sku_id", flat=True):
        if _sku_key(sku) in wanted:
            clashes.add(sku)
    return clashes


def _category_slug(category_label):
    return "".join(c if c.isalnum() else "-" for c in category_label[:40]).strip("-").lower() or "bulk-listing"


def _field_value_error(f, value):
    """
    None if `value` satisfies field `f`'s own constraints (dropdown
    membership, numeric shape, the money-format ceiling) — else a message
    describing what's wrong. Shared between the shared-default check and
    the per-row override check below, since a row's override is held to
    exactly the same rule its shared value would be.
    """
    if value in (None, ""):
        return None
    if f["options"] and str(value) not in f["options"]:
        return f"'{value}' isn't a valid {f['label']}."
    if f["type"] == "number":
        if safe_decimal(value) is None:
            return f"'{f['label']}' must be a number."
        if f["money_max"] is not None and not bl.validate_money(value, f["money_max"]):
            return (f"'{f['label']}' must be a positive number under {f['money_max']:,.0f}, "
                    f"with at most 2 decimal places.")
    return None


def _download_filename(original_filename, spec, extension):
    """
    The name to hand back a generated sheet under — the exact name it was
    uploaded (or saved) as, whenever one is known, so a seller doesn't have
    to rename the download back to what their own tooling expects it to be
    called. Falls back to a category slug + timestamp only when there's no
    original name to reuse (the Meesho built-in quick-start has none).
    Strips characters that would break the `Content-Disposition` header
    (quotes, newlines) rather than trusting an uploaded filename verbatim.
    """
    if original_filename:
        return re.sub(r'[\r\n"]', "", original_filename).strip()
    return f"{_category_slug(spec['category_label'])}-{timezone.now().strftime('%Y%m%d-%H%M%S')}.{extension}"


def _generate_flipkart(request, business, spec, wb, original_filename):
    """
    Flipkart's own generate path — kept entirely separate from Meesho's
    below rather than threaded through the same branches, because the two
    don't share a payload shape: Meesho sends one `shared` dict (same value
    on every row) plus a thin per-row identity (title/sku/style/group), a
    top-level `image_urls` list, and lets the server shuffle images across
    rows. Flipkart sends `rows`, each already carrying its own `sku_id`,
    its own `images` (already fixed to that row — no shuffling — in
    whatever order the UI's drag-reordering left them), and its own
    `attributes` dict, since attribute values can genuinely differ row to
    row here (a seller might copy one row's values to the others client-side
    first, but that's a UI convenience, not something this endpoint needs to
    know about).
    """
    sku_field = blf.find_field(spec, role="sku")
    if not sku_field:
        return Response({"error": "Could not find a SKU ID column in this template."},
                        status=status.HTTP_400_BAD_REQUEST)

    raw_payload = request.data.get("payload")
    try:
        payload = json.loads(raw_payload) if raw_payload else {}
    except (TypeError, ValueError):
        return Response({"error": "Malformed form data."}, status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(payload, dict):
        payload = {}

    rows_in = payload.get("rows")
    if not isinstance(rows_in, list) or not rows_in:
        return Response({"error": "No rows to generate — upload a template with at least one row."},
                        status=status.HTTP_400_BAD_REQUEST)
    if len(rows_in) > bl.MAX_ROWS:
        return Response({"error": f"That's {len(rows_in)} rows — {bl.MAX_ROWS} is the most one sheet can hold."},
                        status=status.HTTP_400_BAD_REQUEST)

    slot_fields = [f for role in blf.image_slots(spec) for f in spec["fields"] if f["role"] == role]
    attribute_fields = [f for f in spec["fields"] if f["role"] not in blf.PER_ROW_ROLES]
    # Shipping provider / procurement type are fixed for this seller — see
    # bulk_listing_flipkart.FORCED_ATTRIBUTE_VALUES — merged in below so
    # they're always present and correct regardless of what (if anything)
    # the UI sent for them.
    forced = blf.forced_attributes(spec)

    skus, rows = [], []
    for i, row in enumerate(rows_in):
        if not isinstance(row, dict):
            return Response({"error": "Malformed row data."}, status=status.HTTP_400_BAD_REQUEST)

        sku = str(row.get("sku_id") or "").strip()
        if not sku:
            return Response({"error": f"Row {i + 1}: enter a SKU id."}, status=status.HTTP_400_BAD_REQUEST)

        images_in = row.get("images") if isinstance(row.get("images"), list) else []
        images = [str(u).strip() for u in images_in][:len(slot_fields)]
        images += [""] * (len(slot_fields) - len(images))
        for u in images:
            if u and not u.lower().startswith(("http://", "https://")):
                return Response({"error": f"Row {i + 1}: '{u}' doesn't look like a link."},
                                status=status.HTTP_400_BAD_REQUEST)
        if slot_fields and slot_fields[0]["required"] and not images[0]:
            return Response({"error": f"Row {i + 1}: {slot_fields[0]['label']} is required."},
                            status=status.HTTP_400_BAD_REQUEST)

        attrs_in = row.get("attributes") if isinstance(row.get("attributes"), dict) else {}
        attrs_in = {**attrs_in, **forced}
        attrs = {}
        for f in attribute_fields:
            value = attrs_in.get(f["key"])
            if value in (None, ""):
                if f["required"]:
                    return Response({"error": f"Row {i + 1}: {f['label']} is required."},
                                    status=status.HTTP_400_BAD_REQUEST)
                continue
            value = str(value)
            if f["options"] and value not in f["options"]:
                return Response({"error": f"Row {i + 1}: '{value}' isn't a valid {f['label']}."},
                                status=status.HTTP_400_BAD_REQUEST)
            if f["type"] == "number" and safe_decimal(value) is None:
                return Response({"error": f"Row {i + 1}: '{f['label']}' must be a number."},
                                status=status.HTTP_400_BAD_REQUEST)
            attrs[f["key"]] = value

        skus.append(sku)
        rows.append({"sku_id": sku, "images": images, "attributes": attrs})

    if len({_sku_key(s) for s in skus}) != len(skus):
        return Response({"error": "SKU ids must be different for every row."},
                        status=status.HTTP_400_BAD_REQUEST)

    clash = _existing_sku_clash(business, skus)
    if clash:
        return Response({"error": f"Already used in your catalogue: {', '.join(sorted(clash))}"},
                        status=status.HTTP_409_CONFLICT)

    result_wb = blf.build_workbook(spec, wb, rows)
    buf = BytesIO()
    result_wb.save(buf)
    buf.seek(0)

    filename = _download_filename(original_filename, spec, "xls")
    resp = HttpResponse(buf.read(), content_type="application/vnd.ms-excel")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


@api_view(["POST"])
@parser_classes([MultiPartParser])
def bulk_listing_generate(request, business_id):
    business = get_authorized_business(request, business_id)

    try:
        platform, module = _resolve_platform(request)
        wb, original_filename = _resolve_source(request, module, platform, business)
        spec = module.parse_template(wb)
    except KeyError:
        return Response({"error": "Unknown built-in template."}, status=status.HTTP_400_BAD_REQUEST)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    if platform == "flipkart":
        return _generate_flipkart(request, business, spec, wb, original_filename)

    sku_field = bl.find_field(spec, role="sku")
    if not sku_field:
        return Response(
            {"error": "Could not find a SKU ID column in this template."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # Not every platform has one — Flipkart doesn't carry a product-name
    # column at all, so title is only asked for/enforced when it exists.
    title_field = bl.find_field(spec, role="title")

    raw_payload = request.data.get("payload")
    try:
        payload = json.loads(raw_payload) if raw_payload else {}
    except (TypeError, ValueError):
        return Response({"error": "Malformed form data."}, status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(payload, dict):
        payload = {}

    shared_in = payload.get("shared") if isinstance(payload.get("shared"), dict) else {}
    rows_in = payload.get("rows")
    image_urls = payload.get("image_urls")

    # One listing per photo given — "New Sheet" pastes them fresh, "Prefilled
    # Sheet" pulls them from the uploaded sheet's own rows, but either way the
    # photo list *is* the row count from here on.
    if (not isinstance(image_urls, list) or not image_urls
            or not all(str(u or "").strip() for u in image_urls)):
        return Response({"error": "Give at least one image link."}, status=status.HTTP_400_BAD_REQUEST)
    image_urls = [str(u).strip() for u in image_urls]
    for u in image_urls:
        if not u.lower().startswith(("http://", "https://")):
            return Response({"error": f"'{u}' doesn't look like a link."}, status=status.HTTP_400_BAD_REQUEST)
    if len(image_urls) > bl.MAX_ROWS:
        return Response({"error": f"That's {len(image_urls)} photos — {bl.MAX_ROWS} is the most one sheet can hold."},
                        status=status.HTTP_400_BAD_REQUEST)

    if not isinstance(rows_in, list) or len(rows_in) != len(image_urls):
        return Response(
            {"error": f"Send one row per photo — {len(image_urls)} photo(s), {len(rows_in) if isinstance(rows_in, list) else 0} row(s)."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    titles, skus, styles, group_ids = [], [], [], []
    for i, row in enumerate(rows_in):
        if not isinstance(row, dict):
            return Response({"error": "Malformed row data."}, status=status.HTTP_400_BAD_REQUEST)
        title = str(row.get("product_name") or "").strip()
        sku = str(row.get("sku_id") or "").strip()
        style = str(row.get("style_id") or "").strip() or sku
        if title_field and not title:
            return Response({"error": f"Row {i + 1}: enter a product title."}, status=status.HTTP_400_BAD_REQUEST)
        if not sku:
            return Response({"error": f"Row {i + 1}: enter a SKU id."}, status=status.HTTP_400_BAD_REQUEST)
        titles.append(title)
        skus.append(sku)
        styles.append(style)
        # Unlike title/SKU/style, group id is deliberately allowed to repeat —
        # that's what "variation listing" (same group on every row) means.
        group_ids.append(str(row.get("group_id") or "").strip())

    if title_field and len({t.strip().lower() for t in titles}) != len(titles):
        return Response({"error": "Titles must be different for every row."},
                        status=status.HTTP_400_BAD_REQUEST)
    if len({_sku_key(s) for s in skus}) != len(skus):
        return Response({"error": "SKU ids must be different for every row."},
                        status=status.HTTP_400_BAD_REQUEST)
    if len({_sku_key(s) for s in styles}) != len(styles):
        return Response({"error": "Style ids must be different for every row."},
                        status=status.HTTP_400_BAD_REQUEST)

    clash = _existing_sku_clash(business, skus)
    if clash:
        return Response(
            {"error": f"Already used in your catalogue: {', '.join(sorted(clash))}"},
            status=status.HTTP_409_CONFLICT,
        )

    # ── shared fields (copied identically onto every row, unless a specific
    # row overrides one — see BulkListingTab.jsx's per-row override grid) ──
    per_row_keys = {f["key"] for f in spec["fields"] if f["role"] in bl.PER_ROW_ROLES}
    shared = {k: v for k, v in shared_in.items() if k not in per_row_keys}
    field_by_key = {f["key"]: f for f in spec["fields"]}

    # {key: value} per row — only the keys that row actually touched, not
    # every shared field, so an untouched field still falls back to `shared`
    # (see build_workbook) rather than a row silently pinning it to
    # whatever happened to be in the form when the row was first drawn.
    row_overrides = []
    for row in rows_in:
        raw = row.get("overrides") if isinstance(row.get("overrides"), dict) else {}
        row_overrides.append({k: v for k, v in raw.items() if k in field_by_key and k not in per_row_keys})

    # Two fields Meesho's own template computes with a formula — resolved
    # (and written as plain values, not formulas — see bulk_listing.py)
    # *before* the required-fields check below, since Meesho still marks
    # Importer Name/Address/Pincode "Compulsory" even though the template's
    # own formula fills them with "Not Required" whenever the country is
    # India, so the user never has to type them in that case.
    wdrp_field = bl.find_field(spec, role="wrong_defective_price")
    if wdrp_field:
        meesho_price_field = field_by_key.get("meesho_price")
        base_price = shared.get(meesho_price_field["key"]) if meesho_price_field else None
        shared[wdrp_field["key"]] = bl.resolve_wrong_defective_price(
            base_price, shared_in.get(wdrp_field["key"]),
        )

    country_field = bl.find_field(spec, role="country_of_origin")
    imp_name_f = bl.find_field(spec, role="importer_name")
    imp_addr_f = bl.find_field(spec, role="importer_address")
    imp_pin_f = bl.find_field(spec, role="importer_pincode")
    if country_field and (imp_name_f or imp_addr_f or imp_pin_f):
        country_value = str(shared.get(country_field["key"]) or "")
        name, addr, pin = bl.resolve_importer_fields(
            country_value,
            shared_in.get(imp_name_f["key"], "") if imp_name_f else "",
            shared_in.get(imp_addr_f["key"], "") if imp_addr_f else "",
            shared_in.get(imp_pin_f["key"], "") if imp_pin_f else "",
        )
        if country_value.strip().lower() != "india" and not (name and addr and pin):
            return Response(
                {"error": "Importer name/address/pincode are required when country of origin isn't India."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if imp_name_f:
            shared[imp_name_f["key"]] = name
        if imp_addr_f:
            shared[imp_addr_f["key"]] = addr
        if imp_pin_f:
            shared[imp_pin_f["key"]] = pin

    missing = [
        f["label"] for f in spec["fields"]
        if f["required"] and f["role"] not in bl.PER_ROW_ROLES
        and not str(shared.get(f["key"], "")).strip()
    ]
    if missing:
        return Response({"error": f"Required: {', '.join(missing)}."}, status=status.HTTP_400_BAD_REQUEST)

    for f in spec["fields"]:
        if f["role"] in bl.PER_ROW_ROLES:
            continue
        err = _field_value_error(f, shared.get(f["key"]))
        if err:
            return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)

    # A row can still override a required field down to blank even when the
    # shared default fills it in — that's a row-specific mistake, not a
    # global "you haven't filled in Product Details yet" one, so it's
    # checked (and reported) separately from the two loops above. Only
    # touched keys are checked — see row_overrides — so an untouched
    # required field never double-reports here (it's already covered by
    # `missing` via its shared value).
    for i, overrides in enumerate(row_overrides):
        for key, value in overrides.items():
            f = field_by_key[key]
            if f["required"] and not str(value or "").strip():
                return Response({"error": f"Row {i + 1}: {f['label']} is required."},
                                status=status.HTTP_400_BAD_REQUEST)
            err = _field_value_error(f, value)
            if err:
                return Response({"error": f"Row {i + 1}: {err}"}, status=status.HTTP_400_BAD_REQUEST)

    slots = bl.image_slots(spec)
    front_field = bl.find_field(spec, role=slots[0]) if slots else None

    # The client now composes each row's own gallery (shuffle/delete/add —
    # see BulkListingTab.jsx's planRowImages, the JS mirror of plan_images
    # used to seed a row before the seller can hand-edit it) and sends it
    # explicitly, the same contract Flipkart's rows already use. Only fall
    # back to a fresh server-side shuffle when a row didn't send one at all
    # — the shipped UI always does now; this only guards a bare API call.
    rows_images = []
    for i, row in enumerate(rows_in):
        imgs = row.get("images")
        if not (isinstance(imgs, list) and imgs):
            rows_images.append(None)
            continue
        cleaned = [str(u).strip() for u in imgs][:len(slots)]
        cleaned += [""] * (len(slots) - len(cleaned))
        for u in cleaned:
            if u and not u.lower().startswith(("http://", "https://")):
                return Response({"error": f"Row {i + 1}: '{u}' doesn't look like a link."},
                                status=status.HTTP_400_BAD_REQUEST)
        if front_field and front_field["required"] and not cleaned[0]:
            return Response({"error": f"Row {i + 1}: {front_field['label']} is required."},
                            status=status.HTTP_400_BAD_REQUEST)
        rows_images.append(cleaned)

    planned = rows_images if all(imgs is not None for imgs in rows_images) else bl.plan_images(image_urls, len(slots))
    rows = [
        {
            "product_name": titles[i], "sku_id": skus[i], "style_id": styles[i],
            "group_id": group_ids[i], "images": planned[i], "overrides": row_overrides[i],
        }
        for i in range(len(image_urls))
    ]

    result_wb = bl.build_workbook(spec, wb, shared, rows)
    buf = BytesIO()
    result_wb.save(buf)
    buf.seek(0)

    filename = _download_filename(original_filename, spec, "xlsx")
    resp = HttpResponse(buf.read(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


@api_view(["GET", "POST"])
def bulk_listing_presets(request, business_id):
    """
    GET  — every preset saved for this business.
    POST — save one. An existing preset with the same name is updated in
           place (case-insensitively), so "Save as preset" is idempotent per
           name — same behaviour as listing_templates_list's "same name
           updates" rule.
    """
    business = get_authorized_business(request, business_id)

    if request.method == "POST":
        payload = request.data if isinstance(request.data, dict) else {}
        name = str(payload.get("name") or "").strip()
        if not name:
            return Response({"error": "Give the preset a name."}, status=status.HTTP_400_BAD_REQUEST)
        fields = payload.get("fields")
        if not isinstance(fields, dict):
            return Response({"error": "fields must be an object of key → value."},
                            status=status.HTTP_400_BAD_REQUEST)
        labels = payload.get("labels") if isinstance(payload.get("labels"), dict) else {}
        source_label = str(payload.get("source_label") or "")[:255]

        existing = BulkListingFieldPreset.objects.filter(business=business, name__iexact=name).first()
        if existing:
            existing.fields = fields
            existing.labels = labels
            existing.source_label = source_label
            existing.created_by = request.user
            existing.save()
            preset, created = existing, False
        else:
            preset = BulkListingFieldPreset.objects.create(
                business=business, name=name, fields=fields, labels=labels,
                source_label=source_label, created_by=request.user,
            )
            created = True

        return Response(
            {"created": created, "preset": BulkListingFieldPresetSerializer(preset).data},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    presets = BulkListingFieldPreset.objects.filter(business=business).select_related("created_by")
    return Response({"results": BulkListingFieldPresetSerializer(presets, many=True).data})


@api_view(["DELETE"])
def bulk_listing_preset_detail(request, business_id, pk):
    business = get_authorized_business(request, business_id)
    try:
        preset = BulkListingFieldPreset.objects.get(pk=pk, business=business)
    except BulkListingFieldPreset.DoesNotExist:
        return Response({"error": "Preset not found."}, status=status.HTTP_404_NOT_FOUND)
    preset.delete()
    return Response({"deleted": True})


@api_view(["GET", "POST"])
@parser_classes([MultiPartParser])
def bulk_listing_flipkart_templates(request, business_id):
    """
    GET  — every Flipkart template saved for this business (metadata only —
           see FlipkartBulkTemplateSerializer for why `file_data` never
           leaves this endpoint).
    POST — save an uploaded `.xls`/`.xlsx` as a reusable template. Same
           "same name updates in place" idempotency as bulk_listing_presets.
           Parsed with the real Flipkart parser first (not just stashed
           blindly) so a saved template is guaranteed loadable later — a
           bad upload fails here, at save time, not on some future generate.
    """
    business = get_authorized_business(request, business_id)

    if request.method == "POST":
        name = str(request.data.get("name") or "").strip()
        if not name:
            return Response({"error": "Give the template a name."}, status=status.HTTP_400_BAD_REQUEST)
        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"error": "Upload a file."}, status=status.HTTP_400_BAD_REQUEST)

        file_bytes = uploaded.read()
        try:
            spec = blf.parse_template(blf.load_workbook(BytesIO(file_bytes)))
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if not blf.find_field(spec, role="sku"):
            return Response({"error": "Could not find a SKU ID column in this template."},
                            status=status.HTTP_400_BAD_REQUEST)

        existing = FlipkartBulkTemplate.objects.filter(business=business, name__iexact=name).first()
        if existing:
            existing.category_label = spec["category_label"]
            existing.original_filename = uploaded.name
            existing.file_data = file_bytes
            existing.created_by = request.user
            existing.save()
            template, created = existing, False
        else:
            template = FlipkartBulkTemplate.objects.create(
                business=business, name=name, category_label=spec["category_label"],
                original_filename=uploaded.name, file_data=file_bytes, created_by=request.user,
            )
            created = True

        return Response(
            {"created": created, "template": FlipkartBulkTemplateSerializer(template).data},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    templates = FlipkartBulkTemplate.objects.filter(business=business).select_related("created_by")
    return Response({"results": FlipkartBulkTemplateSerializer(templates, many=True).data})


@api_view(["DELETE"])
def bulk_listing_flipkart_template_detail(request, business_id, pk):
    business = get_authorized_business(request, business_id)
    try:
        template = FlipkartBulkTemplate.objects.get(pk=pk, business=business)
    except FlipkartBulkTemplate.DoesNotExist:
        return Response({"error": "Template not found."}, status=status.HTTP_404_NOT_FOUND)
    template.delete()
    return Response({"deleted": True})
