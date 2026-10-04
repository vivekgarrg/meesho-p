"""
Listing images: Quadrant Cropper -> Cloudflare R2 -> linked to a parent SKU.

The flow, from the browser's side:

  1. config   — is storage set up at all? (no: the cropper stays download-only)
  2. parents  — search parents for the "which product is this?" picker
  3. presign  — "here are N images (hash, type, size) for parent P": creates P
                if asked, allocates each image its permanent number, and
                returns a signed PUT url per image. Numbers come back BEFORE
                the zip is built, so the downloaded files carry them too.
  4. (browser PUTs each image straight to R2)
  5. confirm  — the server checks each object really is in the bucket, and
                only then marks it uploaded. Only uploaded images count as
                linked; see ListingImage for why.
  6. list     — a parent's images, for SKU Pricing.

Nothing about the bucket lives here — see object_storage.py.
"""

import re
import uuid

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import object_storage
from .models import ListingImage, ListingImageCounter, ParentItemPrice
from .permissions import get_authorized_business
from .views import clean_new_parent_pricing

MAX_FILES_PER_BATCH = 200
MAX_IMAGE_BYTES = 15 * 1024 * 1024
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _storage_unavailable():
    problem = object_storage.credential_problem()
    return Response(
        {"error": problem or "Image upload isn't set up on this server yet — download only for now."},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


def _image_dict(img):
    return {
        "id": img.pk,
        "image_no": img.image_no,
        "public_url": object_storage.public_url(img.key),
        "product_name": img.product_name,
        "folder": img.folder,
        "parent": img.parent.item_id if img.parent_id else None,
        "bytes": img.bytes,
        "content_type": img.content_type,
        "status": img.status,
        "uploaded_at": img.uploaded_at,
    }


FOLDER_MAX = 100  # keeps the whole key well inside the 255-char column
MAX_FOLDER_SUFFIX = 999


def _file_base(name):
    """A product name made safe as a file/folder name — the SAME rule the
    cropper's itemFileBase() applies to the zip, so the folder in R2 and the
    zip the seller downloaded carry exactly the same name. Only characters no
    OS allows are dropped; spaces and casing survive as typed."""
    text = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", name or "")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^\.+|\.+$", "", text).strip()
    return text[:FOLDER_MAX].strip()


def _resolve_folder(business, parent, base):
    """The folder this batch goes in: the product name, or the product name
    with -001, -002, … when that name is already some *other* product's.

    A folder belongs to one parent. A later batch for the same parent goes
    into its existing folder (that product's photos stay together); a
    different parent that reuses the name gets the next free suffix, so two
    products never share a folder. Compared case-insensitively — "Brass Diya"
    and "brass diya" side by side in the dashboard would be two folders
    that look like one.

    Must be called with the business's counter row locked (presign does), so
    two batches can't both claim the same free name at once.
    """
    spelling, owners = {}, {}
    for folder, parent_id in (ListingImage.objects.filter(business=business)
                              .exclude(folder="").values_list("folder", "parent_id")):
        key = folder.casefold()
        spelling.setdefault(key, folder)
        owners.setdefault(key, set()).add(parent_id)

    for n in range(0, MAX_FOLDER_SUFFIX + 1):
        candidate = base if n == 0 else f"{base}-{n:03d}"
        key = candidate.casefold()
        if key not in owners:
            return candidate
        if owners[key] - {None} == {parent.pk}:
            return spelling[key]
    # 1000 different products all named the same: give up on suffixes.
    return f"{base}-{uuid.uuid4().hex[:6]}"


def _still_in_bucket(img):
    """Is an image recorded as uploaded actually still in the bucket?

    Only asked when a crop matches an existing image, so it costs one HEAD
    per repeated crop, not one per upload. If storage can't be reached to
    tell, assume yes: refusing a whole batch over a lookup failure would be
    worse than trusting the record.
    """
    try:
        return object_storage.object_size(img.key) is not None
    except Exception:
        return True


def _build_key(business, folder, file_base, image_no, ext):
    # listing-images/<business>/<folder>/<product>-<number>.<ext>
    # The business segment is not decoration: image numbers are per business,
    # so without it two businesses' "Brass Diya-1.jpg" would be one object.
    return f"listing-images/{business.pk}/{folder}/{file_base}-{image_no}.{ext}"


@api_view(["GET"])
def listing_images_config(request, business_id):
    get_authorized_business(request, business_id)
    ready = object_storage.is_ready()
    return Response({
        "enabled": ready,
        "public_base_url": settings.S3_PUBLIC_BASE_URL if ready else "",
        # Set only when storage is configured but can't work — the cropper
        # shows it, so a broken setup says what's wrong instead of quietly
        # falling back to download-only.
        "problem": object_storage.credential_problem(),
    })


@api_view(["POST"])
def listing_images_check(request, business_id):
    """Run a real storage round trip and report each step — the cropper's
    "Test connection". POST because it writes (then deletes) a test file."""
    get_authorized_business(request, business_id)
    steps = object_storage.probe()
    return Response({"ok": all(step["ok"] for step in steps), "steps": steps})


@api_view(["GET"])
def listing_images_parents(request, business_id):
    """Parent search for the cropper's picker.

    Its own endpoint rather than parent-prices/, which also reprices and
    deletes parents — the cropper only ever needs to read names, and giving
    it the whole pricing family to do that would hand cropper-only users far
    more than this screen needs.
    """
    business = get_authorized_business(request, business_id)
    q = str(request.GET.get("search") or "").strip()
    qs = ParentItemPrice.objects.filter(business=business)
    if q:
        qs = qs.filter(item_id__icontains=q)
    rows = (
        qs.annotate(
            image_count=Count("listing_images",
                              filter=Q(listing_images__status=ListingImage.STATUS_UPLOADED),
                              distinct=True),
            sku_count=Count("sku_prices", distinct=True),
        )
        .order_by("item_id")
        .values("item_id", "image_count", "sku_count", "image_url")[:50]
    )
    return Response({"results": list(rows)})


@api_view(["POST"])
def listing_images_presign(request, business_id):
    """Resolve (or create) the parent, number every image, sign their uploads.

    Body:
      {"parent_id": "DIYA-THALI", "create_parent": false,
       "product_name": "Brass Pooja Plate",
       "files": [{"sha256": "…", "content_type": "image/jpeg", "bytes": 81234}, …]}

    With create_parent, item_price / tax_percent / packaging_cost are
    required too (clean_new_parent_pricing) — a parent without a price costs
    every SKU under it at zero.

    The response's `folder` and `file_base` are what the zip must be named
    with: the bucket folder and the downloaded zip carry the same name.

    Results come back in the same order as `files`. An image whose hash is
    already uploaded is returned as a duplicate — its existing number and url,
    nothing to upload — instead of being stored twice. An image still
    `pending` from an earlier attempt that never finished is re-signed under
    its existing number, so retrying never burns new numbers or leaves
    orphans behind.
    """
    business = get_authorized_business(request, business_id)
    if not object_storage.is_ready():
        return _storage_unavailable()

    data = request.data if isinstance(request.data, dict) else {}
    parent_id = str(data.get("parent_id") or "").strip()
    create_parent = bool(data.get("create_parent"))
    product_name = str(data.get("product_name") or "").strip()[:255]
    files = data.get("files")

    if not parent_id:
        return Response({"error": "Pick a parent SKU, or name a new one."},
                        status=status.HTTP_400_BAD_REQUEST)
    file_base = _file_base(product_name)
    if not file_base:
        return Response({"error": "Enter the product name — the folder and files are named after it."},
                        status=status.HTTP_400_BAD_REQUEST)
    if len(parent_id) > 200:
        return Response({"error": "That parent SKU name is too long (200 characters max)."},
                        status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(files, list) or not files:
        return Response({"error": "No images to upload."}, status=status.HTTP_400_BAD_REQUEST)
    if len(files) > MAX_FILES_PER_BATCH:
        return Response({"error": f"{len(files)} images is too many at once — {MAX_FILES_PER_BATCH} max."},
                        status=status.HTTP_400_BAD_REQUEST)

    cleaned = []
    for i, f in enumerate(files):
        if not isinstance(f, dict):
            return Response({"error": f"Image {i + 1}: malformed."}, status=status.HTTP_400_BAD_REQUEST)
        sha = str(f.get("sha256") or "").strip().lower()
        ctype = str(f.get("content_type") or "").strip().lower()
        try:
            size = int(f.get("bytes") or 0)
        except (TypeError, ValueError):
            size = 0
        if not _SHA256.match(sha):
            return Response({"error": f"Image {i + 1}: missing or invalid hash."},
                            status=status.HTTP_400_BAD_REQUEST)
        if ctype not in object_storage.ALLOWED_CONTENT_TYPES:
            return Response({"error": f"Image {i + 1}: {ctype or 'unknown type'} isn't a JPG, PNG or WebP."},
                            status=status.HTTP_400_BAD_REQUEST)
        if size <= 0 or size > MAX_IMAGE_BYTES:
            return Response({"error": f"Image {i + 1}: size must be between 1 byte and 15 MB."},
                            status=status.HTTP_400_BAD_REQUEST)
        cleaned.append((sha, ctype, size))

    pricing = None
    if create_parent:
        pricing, errors = clean_new_parent_pricing(data)
        if errors:
            return Response(
                {"error": " ".join(msg for msgs in errors.values() for msg in msgs), "fields": errors},
                status=status.HTTP_400_BAD_REQUEST,
            )

    with transaction.atomic():
        parent = ParentItemPrice.objects.filter(business=business, item_id__iexact=parent_id).first()
        parent_created = False
        if parent is not None and create_parent:
            # Never silently drop the prices just typed, nor overwrite the
            # existing parent's with them — say so and let the seller choose.
            return Response(
                {"error": f'A parent SKU named "{parent.item_id}" already exists — '
                          'pick it under "Choose existing" instead.'},
                status=status.HTTP_409_CONFLICT,
            )
        if parent is None:
            if not create_parent:
                return Response(
                    {"error": f'No parent SKU named "{parent_id}" — pick one from the list, or create it.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            parent = ParentItemPrice.objects.create(business=business, item_id=parent_id, **pricing)
            parent_created = True

        ListingImageCounter.objects.get_or_create(business=business)
        counter = ListingImageCounter.objects.select_for_update().get(business=business)
        # Resolved under the counter lock so two batches can't claim one name.
        folder = _resolve_folder(business, parent, file_base)

        results, seen = [], {}
        for sha, ctype, size in cleaned:
            if sha in seen:
                # The same crop twice in one batch — one copy, reported twice.
                results.append({**seen[sha], "duplicate": True, "needs_upload": False})
                continue

            uploaded = ListingImage.objects.filter(
                business=business, sha256=sha, status=ListingImage.STATUS_UPLOADED,
            ).select_related("parent").first()
            if uploaded and not _still_in_bucket(uploaded):
                # Recorded as uploaded, but the object has since gone (deleted
                # in the dashboard, say). Treating it as a duplicate would mean
                # it is never uploaded again and its parent stays linked to a
                # 404 — so put it back: same image number, re-signed, and moved
                # into this batch's product folder.
                uploaded.status = ListingImage.STATUS_PENDING
                uploaded.uploaded_at = None
                uploaded.parent = uploaded.parent or parent
                uploaded.product_name = product_name or uploaded.product_name
                uploaded.folder = folder
                uploaded.content_type = ctype
                uploaded.bytes = size
                uploaded.key = _build_key(business, folder, file_base, uploaded.image_no,
                                          object_storage.ALLOWED_CONTENT_TYPES[ctype])
                uploaded.save()
                entry = {
                    **_image_dict(uploaded),
                    "duplicate": False,
                    "needs_upload": True,
                    "restored": True,
                    "put_url": object_storage.presign_put(uploaded.key, ctype),
                }
                seen[sha] = entry
                results.append(entry)
                continue
            if uploaded:
                # Never re-home an image that already belongs to another
                # parent; only adopt one that has none.
                if uploaded.parent_id is None:
                    uploaded.parent = parent
                    uploaded.save(update_fields=["parent"])
                entry = {**_image_dict(uploaded), "duplicate": True, "needs_upload": False}
                seen[sha] = entry
                results.append(entry)
                continue

            img = ListingImage.objects.filter(
                business=business, sha256=sha, status=ListingImage.STATUS_PENDING,
                content_type=ctype,
            ).first()
            if img:
                img.parent = parent
                img.product_name = product_name or img.product_name
                img.bytes = size
                fields = ["parent", "product_name", "bytes"]
                if not img.folder:
                    # A pending record from before folders existed: nothing is
                    # in the bucket under it yet, so moving it into this
                    # batch's folder now costs nothing and saves a move later.
                    img.folder = folder
                    img.key = _build_key(business, folder, file_base, img.image_no,
                                         object_storage.ALLOWED_CONTENT_TYPES[ctype])
                    fields += ["folder", "key"]
                img.save(update_fields=fields)
            else:
                counter.last_no += 1
                img = ListingImage.objects.create(
                    business=business,
                    image_no=counter.last_no,
                    parent=parent,
                    product_name=product_name,
                    folder=folder,
                    sha256=sha,
                    key=_build_key(business, folder, file_base, counter.last_no,
                                   object_storage.ALLOWED_CONTENT_TYPES[ctype]),
                    content_type=ctype,
                    bytes=size,
                    created_by=request.user if request.user.is_authenticated else None,
                )
            entry = {
                **_image_dict(img),
                "duplicate": False,
                "needs_upload": True,
                "put_url": object_storage.presign_put(img.key, ctype),
            }
            seen[sha] = entry
            results.append(entry)

        counter.save(update_fields=["last_no"])

    return Response({
        "parent": {"item_id": parent.item_id, "created": parent_created},
        "folder": folder,
        "file_base": file_base,
        "results": results,
    })


@api_view(["POST"])
def listing_images_confirm(request, business_id):
    """Mark images uploaded — but only after seeing them in the bucket.

    Body: {"ids": [12, 13, …]}

    Trusting the browser's "it worked" would let a request that died
    half-way link a parent to a url that 404s. HEAD on the real object is
    the proof; a size that differs from what was declared counts as failed.
    """
    business = get_authorized_business(request, business_id)
    if not object_storage.is_ready():
        return _storage_unavailable()

    data = request.data if isinstance(request.data, dict) else {}
    raw_ids = data.get("ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        return Response({"error": "No images to confirm."}, status=status.HTTP_400_BAD_REQUEST)
    ids = []
    for v in raw_ids[:MAX_FILES_PER_BATCH]:
        try:
            ids.append(int(v))
        except (TypeError, ValueError):
            continue

    images = {img.pk: img for img in ListingImage.objects.filter(business=business, pk__in=ids)}
    confirmed, failed = [], []
    for pk in ids:
        img = images.get(pk)
        if img is None:
            failed.append({"id": pk, "reason": "unknown image"})
            continue
        if img.status == ListingImage.STATUS_UPLOADED:
            confirmed.append(pk)
            continue
        try:
            size = object_storage.object_size(img.key)
        except Exception as exc:
            # Name what storage actually said. "Could not reach storage" for a
            # rejected key reads as a network blip and gets retried forever.
            code = getattr(exc, "response", {}).get("Error", {}).get("Code") if hasattr(exc, "response") else None
            if code in ("InvalidAccessKeyId", "SignatureDoesNotMatch", "InvalidArgument",
                        "AccessDenied", "Unauthorized"):
                reason = (f"image storage rejected the server's credentials ({code}) — "
                          "check S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY and run verify_object_storage")
            elif code:
                reason = f"image storage returned {code} — try again"
            else:
                reason = "could not reach image storage — try again"
            failed.append({"id": pk, "reason": reason})
            continue
        if size is None:
            failed.append({"id": pk, "reason": "not in storage — the upload didn't finish"})
            continue
        if img.bytes and size != img.bytes:
            failed.append({"id": pk, "reason": "upload incomplete (size mismatch)"})
            continue
        img.status = ListingImage.STATUS_UPLOADED
        img.uploaded_at = timezone.now()
        img.save(update_fields=["status", "uploaded_at"])
        confirmed.append(pk)

    for parent_id in {img.parent_id for img in images.values() if img.parent_id}:
        set_default_parent_image(ParentItemPrice.objects.get(pk=parent_id))

    return Response({"confirmed": confirmed, "failed": failed})


def set_default_parent_image(parent):
    """Give a parent with no picture its first uploaded photo (lowest image
    number), so its card in SKU Pricing shows the product instead of a "no
    image" badge.

    Only ever fills an EMPTY image_url: a link the seller pasted themselves (a
    Meesho catalog image, say) is theirs and is never overwritten. Returns
    True if it set one.
    """
    if parent.image_url:
        return False
    first = (ListingImage.objects
             .filter(parent=parent, status=ListingImage.STATUS_UPLOADED)
             .order_by("image_no").first())
    if first is None:
        return False
    parent.image_url = object_storage.public_url(first.key)
    parent.save(update_fields=["image_url"])
    return True


@api_view(["GET"])
def listing_images_list(request, business_id):
    """Uploaded images, newest first. `?parent_id=` for one parent's (exact,
    case-insensitive); `?search=` matches product name, parent, or the image
    number itself."""
    business = get_authorized_business(request, business_id)
    qs = (ListingImage.objects
          .filter(business=business, status=ListingImage.STATUS_UPLOADED)
          .select_related("parent"))
    parent_id = str(request.GET.get("parent_id") or "").strip()
    if parent_id:
        qs = qs.filter(parent__item_id__iexact=parent_id)
    q = str(request.GET.get("search") or "").strip()
    if q:
        cond = Q(product_name__icontains=q) | Q(parent__item_id__icontains=q)
        if q.lstrip("#").isdigit():
            cond |= Q(image_no=int(q.lstrip("#")))
        qs = qs.filter(cond)
    return Response({"results": [_image_dict(img) for img in qs[:300]]})
