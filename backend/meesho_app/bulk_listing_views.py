"""
Bulk listing sheet generator — endpoints for BulkListingTab.jsx.

Fully stateless with respect to the template itself: nothing about an
uploaded `.xlsx` is stored server-side. The browser hangs onto the `File` (or
a `built_in=` key for the bundled quick-start template) and resends it on
both `parse` (to get the field list to render a form from) and `generate`
(to actually build the output) — see bulk_listing.py's module docstring for
why. The only thing that *is* persisted is a saved preset's field VALUES
(BulkListingFieldPreset), which is the actual explicit ask ("save the field
so I can reuse them") and has nothing to do with the template file.
"""

import json
from io import BytesIO

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from . import bulk_listing as bl
from .models import BulkListingFieldPreset, FinalPrice, TaskListing
from .permissions import get_authorized_business
from .serializers import BulkListingFieldPresetSerializer
from .views import _sku_key, _workbook_from_upload, safe_decimal


def _resolve_source(request):
    """
    The template to use for this request: whatever file was uploaded, or the
    built-in one the caller named. Returns an openpyxl Workbook, or raises
    ValueError (bad file) / KeyError (unknown built_in) for the view to turn
    into a 400.
    """
    uploaded = request.FILES.get("file")
    built_in = str(request.data.get("built_in") or "").strip()
    if uploaded:
        source, _extracted = _workbook_from_upload(uploaded)
        return bl.load_workbook(source)
    if built_in:
        return bl.load_workbook(bl.built_in_path(built_in))
    raise ValueError("Upload a template file, or pick a built-in one.")


@api_view(["GET"])
def bulk_listing_built_ins(request, business_id):
    get_authorized_business(request, business_id)
    return Response({"results": bl.category_choices()})


@api_view(["POST"])
@parser_classes([MultiPartParser])
def bulk_listing_parse(request, business_id):
    get_authorized_business(request, business_id)
    try:
        wb = _resolve_source(request)
        spec = bl.parse_template(wb)
    except KeyError:
        return Response({"error": "Unknown built-in template."}, status=status.HTTP_400_BAD_REQUEST)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    if not bl.find_field(spec, role="title") or not bl.find_field(spec, role="sku"):
        return Response(
            {"error": "Could not find a Product Name / SKU ID column in this template."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response({
        "category_label": spec["category_label"],
        "fields": [
            {k: v for k, v in f.items() if k not in ("column", "mirror_columns")}
            for f in spec["fields"]
        ],
        # Photos already sitting in this sheet's own data rows, one per row —
        # empty for a genuinely blank template. This is what the "Prefilled
        # Sheet" flow in the UI builds its listings from; "New Sheet" ignores it.
        "prefilled_images": bl.extract_front_images(spec, wb),
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


@api_view(["POST"])
@parser_classes([MultiPartParser])
def bulk_listing_generate(request, business_id):
    business = get_authorized_business(request, business_id)

    try:
        wb = _resolve_source(request)
        spec = bl.parse_template(wb)
    except KeyError:
        return Response({"error": "Unknown built-in template."}, status=status.HTTP_400_BAD_REQUEST)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    title_field = bl.find_field(spec, role="title")
    sku_field = bl.find_field(spec, role="sku")
    if not title_field or not sku_field:
        return Response(
            {"error": "Could not find a Product Name / SKU ID column in this template."},
            status=status.HTTP_400_BAD_REQUEST,
        )

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
        if not title:
            return Response({"error": f"Row {i + 1}: enter a product title."}, status=status.HTTP_400_BAD_REQUEST)
        if not sku:
            return Response({"error": f"Row {i + 1}: enter a SKU id."}, status=status.HTTP_400_BAD_REQUEST)
        titles.append(title)
        skus.append(sku)
        styles.append(style)
        # Unlike title/SKU/style, group id is deliberately allowed to repeat —
        # that's what "variation listing" (same group on every row) means.
        group_ids.append(str(row.get("group_id") or "").strip())

    if len({t.strip().lower() for t in titles}) != len(titles):
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

    # ── shared fields (copied identically onto all 4 rows) ─────────────────
    per_row_keys = {f["key"] for f in spec["fields"] if f["role"] in bl.PER_ROW_ROLES}
    shared = {k: v for k, v in shared_in.items() if k not in per_row_keys}
    field_by_key = {f["key"]: f for f in spec["fields"]}

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
        if not f["options"] or f["role"] in bl.PER_ROW_ROLES:
            continue
        value = shared.get(f["key"])
        if value in (None, ""):
            continue
        if str(value) not in f["options"]:
            return Response({"error": f"'{value}' isn't a valid {f['label']}."},
                            status=status.HTTP_400_BAD_REQUEST)

    for f in spec["fields"]:
        if f["type"] != "number" or f["role"] in bl.PER_ROW_ROLES:
            continue
        value = shared.get(f["key"])
        if value in (None, ""):
            continue
        if safe_decimal(value) is None:
            return Response({"error": f"'{f['label']}' must be a number."},
                            status=status.HTTP_400_BAD_REQUEST)
        # Money-shaped fields (Meesho Price, MRP, …) carry a real constraint
        # in the template's own validation — positive, at most 2 decimal
        # places, under some ceiling — enforced here so a value Meesho would
        # itself reject never makes it into the generated sheet.
        if f["money_max"] is not None and not bl.validate_money(value, f["money_max"]):
            return Response(
                {"error": f"'{f['label']}' must be a positive number under {f['money_max']:,.0f}, "
                          f"with at most 2 decimal places."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    slots = bl.image_slots(spec)
    planned = bl.plan_images(image_urls, len(slots))
    rows = [
        {
            "product_name": titles[i], "sku_id": skus[i], "style_id": styles[i],
            "group_id": group_ids[i], "images": planned[i],
        }
        for i in range(len(image_urls))
    ]

    bl.build_workbook(spec, wb, shared, rows)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    slug = "".join(c if c.isalnum() else "-" for c in spec["category_label"][:40]).strip("-").lower() or "bulk-listing"
    filename = f"{slug}-{timezone.now().strftime('%Y%m%d-%H%M%S')}.xlsx"
    resp = HttpResponse(
        buf.read(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
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
