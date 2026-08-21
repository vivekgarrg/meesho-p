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

from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Q as DQ

from . import bulk_listing as bl
from . import bulk_listing_flipkart as blf
from .models import (
    BulkListingBatch, BulkListingFieldPreset, FinalPrice, FlipkartBulkTemplate,
    ParentItemPrice, Product, TaskListing, WorkerTask,
)
from .permissions import get_authorized_business
from .serializers import (
    BulkListingBatchDetailSerializer, BulkListingBatchSerializer, BulkListingFieldPresetSerializer,
    FlipkartBulkTemplateSerializer,
)
from .views import (
    _approve_listing, _bulk_link_skus_to_parent, _is_admin, _reject_listing,
    _sku_key, _workbook_from_upload, safe_decimal,
)

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
    previously-saved Flipkart template (`template_id=`), a previously
    generated batch (`batch_id=` — "load this back into the form to edit"),
    or (Meesho only — Flipkart's field set is too category-specific for one
    bundled example to generalize) the built-in one the caller named.

    Returns `(workbook, original_filename, source_meta)` — `workbook` in
    whatever shape `module.load_workbook` returns, `original_filename` the
    name to reuse verbatim for the generated download (None for a built-in,
    which has no "original" filename of its own — the caller falls back to a
    slug in that case), and `source_meta` a dict describing what was used
    (`kind`, `built_in_key`, `template`, `file_bytes`) for BulkListingBatch
    persistence. Raises ValueError (bad file / unknown template) / KeyError
    (unknown built_in) for the view to turn into a 400.
    """
    uploaded = request.FILES.get("file")
    built_in = str(request.data.get("built_in") or "").strip()
    template_id = str(request.data.get("template_id") or "").strip()
    batch_id = str(request.data.get("batch_id") or "").strip()
    if uploaded:
        uploaded.seek(0)
        file_bytes = uploaded.read()
        uploaded.seek(0)
        source, _extracted = _workbook_from_upload(uploaded)
        meta = {"kind": BulkListingBatch.SOURCE_FILE, "built_in_key": "", "template": None,
                "file_bytes": file_bytes}
        return module.load_workbook(source), uploaded.name, meta
    if template_id:
        if platform != "flipkart":
            raise ValueError("Saved templates are a Flipkart-only feature.")
        try:
            template = FlipkartBulkTemplate.objects.get(pk=template_id, business=business)
        except (FlipkartBulkTemplate.DoesNotExist, ValueError):
            raise ValueError("That saved template no longer exists.")
        meta = {"kind": BulkListingBatch.SOURCE_TEMPLATE, "built_in_key": "", "template": template,
                "file_bytes": bytes(template.file_data)}
        return module.load_workbook(BytesIO(bytes(template.file_data))), template.original_filename, meta
    if batch_id:
        try:
            batch = BulkListingBatch.objects.get(pk=batch_id, business=business)
        except (BulkListingBatch.DoesNotExist, ValueError):
            raise ValueError("That generated batch no longer exists.")
        if not batch.source_file_data:
            raise ValueError("This batch's original template is no longer available to edit.")
        meta = {"kind": batch.source_kind, "built_in_key": batch.source_built_in_key,
                "template": batch.source_template, "file_bytes": bytes(batch.source_file_data)}
        return (module.load_workbook(BytesIO(bytes(batch.source_file_data))),
                batch.source_original_filename, meta)
    if built_in:
        if platform != "meesho":
            raise ValueError("This platform has no built-in template — upload one.")
        path = module.built_in_path(built_in)
        with open(path, "rb") as fh:
            file_bytes = fh.read()
        meta = {"kind": BulkListingBatch.SOURCE_BUILT_IN, "built_in_key": built_in, "template": None,
                "file_bytes": file_bytes}
        return module.load_workbook(path), None, meta
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
        wb, _original_filename, _source_meta = _resolve_source(request, module, platform, business)
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
    business's catalogue — priced (FinalPrice), a parent SKU (ParentItemPrice),
    or already listed via a team task (TaskListing) — so a generated sheet
    can't silently collide. Every SKU a Bulk Listing generation produces is
    registered into FinalPrice immediately (see _persist_batch_and_worker_task),
    so this same check also catches collisions against other batches that
    haven't been approved yet."""
    wanted = {_sku_key(s) for s in sku_ids}
    clashes = set()
    for sku in FinalPrice.objects.filter(business=business).values_list("sku_id", flat=True):
        if _sku_key(sku) in wanted:
            clashes.add(sku)
    for sku in TaskListing.objects.filter(business=business).values_list("sku_id", flat=True):
        if _sku_key(sku) in wanted:
            clashes.add(sku)
    for sku in ParentItemPrice.objects.filter(business=business).values_list("item_id", flat=True):
        if _sku_key(sku) in wanted:
            clashes.add(sku)
    return clashes


# Flat per-SKU pay for a bulk-listing-generated SKU — deliberately NOT the
# standing Team Tasks PlatformRate (_resolve_rate), which prices a single,
# individually-briefed listing. Generating N SKUs in one bulk upload is much
# less per-SKU effort than N separate manual listings, so it has its own,
# lower, flat rate rather than paying the full per-listing rate N times over.
BULK_LISTING_REWARD_PER_SKU = Decimal("6")


def _persist_batch_and_worker_task(*, business, request, platform, spec, source_meta,
                                    payload_snapshot, sku_ids, filename, file_bytes):
    """
    Everything a successful generation triggers besides the download itself:

      - a BulkListingBatch record (the file bytes, the source template bytes,
        and the row data — so it can be re-downloaded byte-for-byte or
        reloaded into the form to edit and regenerate)
      - every SKU registered into FinalPrice immediately, without a price
        (same pattern as sku_parent_opt_out) — makes the SKU visible to the
        rest of the app right away and closes the race window against
        another generation reusing it before this one is even reviewed
      - one WorkerTask + one TaskListing per SKU, submitted straight into the
        existing Team Tasks review queue — this is what "generating a bulk
        listing now creates paid, reviewable work" (point 5) actually is:
        reusing the pipeline Team Tasks already has, not a new one.

    All in one transaction: a failure partway through must not leave a batch
    recorded without its SKUs registered, or SKUs registered without a
    reviewable task behind them.
    """
    wt_platform = WorkerTask.PLATFORM_MEESHO if platform == "meesho" else WorkerTask.PLATFORM_FLIPKART
    batch_platform = (BulkListingBatch.PLATFORM_MEESHO if platform == "meesho"
                      else BulkListingBatch.PLATFORM_FLIPKART)

    with transaction.atomic():
        batch = BulkListingBatch.objects.create(
            business=business, platform=batch_platform, category_label=spec.get("category_label", ""),
            filename=filename, file_data=file_bytes,
            source_kind=source_meta["kind"], source_built_in_key=source_meta["built_in_key"],
            source_template=source_meta["template"], source_file_data=source_meta["file_bytes"],
            source_original_filename=(source_meta["template"].original_filename
                                      if source_meta["template"] else ""),
            payload_snapshot=payload_snapshot, first_sku_id=sku_ids[0],
            sku_ids=list(sku_ids), row_count=len(sku_ids), created_by=request.user,
        )

        FinalPrice.objects.bulk_create([FinalPrice(business=business, sku_id=s) for s in sku_ids])

        now = timezone.now()
        task = WorkerTask.objects.create(
            business=business, task_type=WorkerTask.TYPE_LISTING, platform=wt_platform,
            title=f"Bulk listing — {spec.get('category_label', '')} "
                  f"({len(sku_ids)} SKU{'s' if len(sku_ids) != 1 else ''}) — {now:%d %b %Y}",
            instructions="Auto-created from a Bulk Listing generation.",
            created_by=request.user,
            reward_amount=BULK_LISTING_REWARD_PER_SKU,
            status=WorkerTask.STATUS_SUBMITTED,
            submitted_at=now, submitted_by=request.user,
        )
        task.assignees.set([request.user])

        TaskListing.objects.bulk_create([
            TaskListing(business=business, task=task, batch=batch, created_by=request.user, sku_id=s)
            for s in sku_ids
        ])
        batch.worker_task = task
        batch.save(update_fields=["worker_task"])
    return batch


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


def _sku_filename_slug(sku_id):
    """A SKU id, made safe for use as a filename (and Content-Disposition
    header value) — alphanumerics/dashes/underscores only."""
    slug = "".join(c if (c.isalnum() or c in "-_") else "-" for c in str(sku_id)[:80]).strip("-")
    return slug or "bulk-listing"


def _download_filename(original_filename, spec, extension, first_sku_id=None):
    """
    The name to hand back a generated sheet under.

    Meesho (first_sku_id given): always named after the batch's first SKU id
    — "the file that starts with that SKU" — regardless of what the source
    template was called, so re-downloading the same batch later is
    predictable and doesn't depend on remembering an unrelated upload name.

    Flipkart (first_sku_id not given) keeps the older rule unchanged: the
    exact name it was uploaded/saved as, whenever known, so a seller doesn't
    have to rename the download back to what their own tooling expects.
    Falls back to a category slug + timestamp only when neither is available.
    Strips characters that would break the `Content-Disposition` header
    (quotes, newlines) rather than trusting an uploaded filename verbatim.
    """
    if first_sku_id:
        return f"{_sku_filename_slug(first_sku_id)}.{extension}"
    if original_filename:
        return re.sub(r'[\r\n"]', "", original_filename).strip()
    return f"{_category_slug(spec['category_label'])}-{timezone.now().strftime('%Y%m%d-%H%M%S')}.{extension}"


def _generate_flipkart(request, business, spec, wb, original_filename, source_meta):
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
    file_bytes = buf.read()

    filename = _download_filename(original_filename, spec, "xls")

    try:
        _persist_batch_and_worker_task(
            business=business, request=request, platform="flipkart", spec=spec,
            source_meta=source_meta, payload_snapshot={"mode": "flipkart", "rows": rows_in},
            sku_ids=skus, filename=filename, file_bytes=file_bytes,
        )
    except IntegrityError:
        return Response(
            {"error": f"Already used in your catalogue: {', '.join(sorted(skus))}"},
            status=status.HTTP_409_CONFLICT,
        )

    resp = HttpResponse(file_bytes, content_type="application/vnd.ms-excel")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp["X-Filename"] = filename
    resp["Access-Control-Expose-Headers"] = "X-Filename"
    return resp


@api_view(["POST"])
@parser_classes([MultiPartParser])
def bulk_listing_generate(request, business_id):
    business = get_authorized_business(request, business_id)

    try:
        platform, module = _resolve_platform(request)
        wb, original_filename, source_meta = _resolve_source(request, module, platform, business)
        spec = module.parse_template(wb)
    except KeyError:
        return Response({"error": "Unknown built-in template."}, status=status.HTTP_400_BAD_REQUEST)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    if platform == "flipkart":
        return _generate_flipkart(request, business, spec, wb, original_filename, source_meta)

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
    file_bytes = buf.read()

    # Meesho files are always named after the batch's first SKU (point 1) —
    # unlike Flipkart, which keeps the original-filename-preserving rule.
    filename = _download_filename(original_filename, spec, "xlsx", first_sku_id=skus[0])

    try:
        _persist_batch_and_worker_task(
            business=business, request=request, platform="meesho", spec=spec,
            source_meta=source_meta,
            payload_snapshot={"mode": str(payload.get("mode") or "new"), "shared": shared_in,
                              "rows": rows_in, "image_urls": image_urls},
            sku_ids=skus, filename=filename, file_bytes=file_bytes,
        )
    except IntegrityError:
        return Response(
            {"error": f"Already used in your catalogue: {', '.join(sorted(skus))}"},
            status=status.HTTP_409_CONFLICT,
        )

    resp = HttpResponse(file_bytes, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp["X-Filename"] = filename
    resp["Access-Control-Expose-Headers"] = "X-Filename"
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


@api_view(["GET"])
def bulk_listing_batches(request, business_id):
    """
    Every bulk listing sheet ever generated for this business — visible to
    every business member, not just whoever generated it, so a teammate
    picking up someone else's batch can still re-download or reuse it.
    """
    business = get_authorized_business(request, business_id)
    qs = (BulkListingBatch.objects.filter(business=business)
          .select_related("created_by", "worker_task").prefetch_related("worker_task__listings"))
    platform = str(request.GET.get("platform") or "").strip().lower()
    if platform:
        qs = qs.filter(platform=platform)
    product_id = request.GET.get("product_id")
    if product_id:
        qs = qs.filter(product_id=product_id)
    search = str(request.GET.get("search") or "").strip()
    if search:
        qs = qs.filter(DQ(filename__icontains=search) | DQ(first_sku_id__icontains=search))
    batches = list(qs[:500])
    return Response({"results": BulkListingBatchSerializer(batches, many=True).data, "total": len(batches)})


@api_view(["GET"])
def bulk_listing_batch_detail(request, business_id, pk):
    business = get_authorized_business(request, business_id)
    try:
        batch = BulkListingBatch.objects.select_related("worker_task").get(pk=pk, business=business)
    except BulkListingBatch.DoesNotExist:
        return Response({"error": "Batch not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(BulkListingBatchDetailSerializer(batch).data)


@api_view(["GET"])
def bulk_listing_batch_download(request, business_id, pk):
    business = get_authorized_business(request, business_id)
    try:
        batch = BulkListingBatch.objects.get(pk=pk, business=business)
    except BulkListingBatch.DoesNotExist:
        return Response({"error": "Batch not found."}, status=status.HTTP_404_NOT_FOUND)
    content_type = ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    if batch.platform == BulkListingBatch.PLATFORM_MEESHO else "application/vnd.ms-excel")
    resp = HttpResponse(bytes(batch.file_data), content_type=content_type)
    resp["Content-Disposition"] = f'attachment; filename="{batch.filename}"'
    return resp


@api_view(["GET"])
def bulk_listing_unlinked_batches(request, business_id):
    """Batches not yet attached to a Product — the pick-list for a Product
    page's "Approve batch" action (see bulk_listing_batch_approve below)."""
    business = get_authorized_business(request, business_id)
    qs = (BulkListingBatch.objects.filter(business=business, product__isnull=True)
          .select_related("created_by", "worker_task"))
    batches = list(qs)
    return Response({"results": BulkListingBatchSerializer(batches, many=True).data, "total": len(batches)})


@api_view(["POST"])
def bulk_listing_batch_approve(request, business_id, pk):
    """
    The "approve once" action for a bulk-listing batch — replaces the old
    two-step flow (link to a product, then approve N SKUs one at a time).
    Body: {"decision": "APPROVE"|"REJECT", "product_id"?: int, "comment"?: str}.

    Optionally links the batch to a product first (same conflict checks the
    old product_link_batch had), then applies the decision to every PENDING
    TaskListing under the batch's task in one transaction, reusing
    _approve_listing/_reject_listing (views.py) so the catalogue-join +
    wallet-credit logic isn't duplicated. Also retroactively links any of
    this batch's listings that were already approved *before* a product was
    picked — same as the old flow, for the case a batch was approved
    standalone and only linked to a product afterwards.
    """
    business = get_authorized_business(request, business_id)
    if not _is_admin(request.user):
        return Response({"error": "Only an admin can approve a batch."}, status=status.HTTP_403_FORBIDDEN)

    try:
        batch = BulkListingBatch.objects.select_related("worker_task", "product").get(pk=pk, business=business)
    except BulkListingBatch.DoesNotExist:
        return Response({"error": "Batch not found."}, status=status.HTTP_404_NOT_FOUND)

    payload = request.data if isinstance(request.data, dict) else {}
    decision = str(payload.get("decision") or "APPROVE").strip().upper()
    if decision not in ("APPROVE", "REJECT"):
        return Response({"error": "decision must be APPROVE or REJECT."}, status=status.HTTP_400_BAD_REQUEST)
    comment = str(payload.get("comment") or "").strip()

    task = batch.worker_task
    if not task:
        return Response({"error": "This batch has no worker task to approve."}, status=status.HTTP_400_BAD_REQUEST)

    product = None
    product_id = payload.get("product_id")
    if product_id:
        try:
            product = Product.objects.select_related("parent_sku").get(pk=product_id, business=business)
        except (Product.DoesNotExist, ValueError, TypeError):
            return Response({"error": "Product not found."}, status=status.HTTP_400_BAD_REQUEST)
        if batch.product_id and batch.product_id != product.pk:
            return Response({"error": "That batch is already linked to a different product."},
                            status=status.HTTP_400_BAD_REQUEST)
        if task.parent_sku_id and task.parent_sku_id != product.parent_sku_id:
            return Response(
                {"error": "This batch's task is already linked to a different parent SKU — can't relink."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    linked = False
    credited_total = Decimal("0")
    approved_count = 0
    rejected_count = 0
    retro_linked = None

    with transaction.atomic():
        if product:
            batch.product = product
            batch.save(update_fields=["product"])
            if not task.parent_sku_id:
                task.parent_sku = product.parent_sku
                task.save(update_fields=["parent_sku"])
            linked = True

            already_approved_skus = list(
                TaskListing.objects.filter(batch=batch, status=TaskListing.STATUS_APPROVED)
                .values_list("sku_id", flat=True)
            )
            if already_approved_skus:
                retro_linked = _bulk_link_skus_to_parent(
                    business=business, parent=product.parent_sku, sku_ids=already_approved_skus,
                )

        # Fetched only now, inside the transaction and after any linking
        # above — each listing's `task` must reflect the just-set
        # parent_sku, or _approve_listing would see a stale, unlinked task
        # and skip the catalogue-parent join entirely.
        pending = list(TaskListing.objects.filter(batch=batch, status=TaskListing.STATUS_PENDING)
                       .select_related("task", "created_by"))

        for listing in pending:
            if decision == "APPROVE":
                _, _, credited = _approve_listing(
                    business=business, listing=listing, reviewer=request.user, comment=comment,
                )
                approved_count += 1
                if credited:
                    credited_total += Decimal(str(credited))
            else:
                _reject_listing(listing=listing, reviewer=request.user, comment=comment)
                rejected_count += 1

    return Response({
        "linked": linked,
        "approved_count": approved_count,
        "rejected_count": rejected_count,
        "credited_total": float(credited_total),
        "retroactively_linked": retro_linked,
    })
