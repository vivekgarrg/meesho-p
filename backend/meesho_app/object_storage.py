"""
The only module that talks to the bucket (Cloudflare R2, S3-compatible).

Kept deliberately small so that everything above it — numbering, dedupe,
parent linking — is plain Django and can be tested with these few functions
mocked out, no credentials or network needed.

Uploads never pass through Django. The browser already holds the cropped
images, so this signs a short-lived PUT url per image and the browser sends
the bytes straight to R2; routing them via the VPS would upload everything
twice and hold multi-MB files in gunicorn memory. The secret key never leaves
the server — a signed url authorises one PUT of one key with one content
type, and expires.
"""

import re

from django.conf import settings

ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

# Long enough for a slow connection to work through a big batch in order,
# short enough that a leaked url is useless soon after.
PUT_URL_TTL_SECONDS = 15 * 60


class StorageNotConfigured(Exception):
    pass


def _r2_shape_problems():
    """R2 S3 keys have a fixed shape — Access Key ID 32 hex, Secret 64 hex.
    The usual mistake is pasting the token page's "Token value" (Cloudflare's
    own API, not S3) into both. Checked here because signing an upload url is
    purely local maths and succeeds with *any* key, so without this a wrong
    key only shows up later as an upload R2 rejects for no visible reason."""
    if "r2.cloudflarestorage.com" not in (settings.S3_ENDPOINT_URL or ""):
        return []
    problems = []
    for name, want in (("S3_ACCESS_KEY_ID", 32), ("S3_SECRET_ACCESS_KEY", 64)):
        value = getattr(settings, name, "") or ""
        hexy = bool(re.fullmatch(r"[0-9a-fA-F]+", value))
        if len(value) != want or not hexy:
            problems.append(
                f"{name} is {len(value)} characters{'' if hexy else ', not plain hex'}"
                f" — an R2 one is exactly {want} hex characters"
            )
    return problems


R2_KEY_HINT = (
    'On R2\'s API token page, use the two values under "Use the following credentials '
    'for S3 clients" — Access Key ID (32) and Secret Access Key (64). The "Token value" '
    "at the top is for Cloudflare's own API, not for this."
)


def credential_problem():
    """Why uploads can't work on this server, in words a person can act on —
    or None if nothing is wrong that can be detected without the network.

    Distinguishes "not set up at all" (None from the caller's point of view is
    still "disabled", but there is nothing to fix) from "set up wrongly",
    which is what deserves a message on screen.
    """
    if not getattr(settings, "OBJECT_STORAGE_READY", False):
        return None
    try:
        import boto3  # noqa: F401
    except ImportError:
        return "boto3 is not installed on this server — run pip install -r requirements.txt."
    problems = _r2_shape_problems()
    if problems:
        return "The storage keys look wrong: " + "; ".join(problems) + ". " + R2_KEY_HINT
    return None


def is_ready():
    """True when uploads can actually work: configured, boto3 importable, and
    keys that are at least the right shape. Anything less hides the upload
    path rather than showing a button that fails without saying why."""
    return bool(getattr(settings, "OBJECT_STORAGE_READY", False)) and credential_problem() is None


def _client():
    if not is_ready():
        raise StorageNotConfigured("Object storage is not configured on this server.")
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL or None,
        aws_access_key_id=settings.S3_ACCESS_KEY_ID,
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
        region_name=settings.S3_REGION,
        config=Config(signature_version="s3v4"),
    )


def public_url(key):
    """The public link for a key. Folders and files are named after products,
    so keys contain spaces and the odd "&" or "#" — percent-encoded here so
    the link is a valid url that Meesho / Flipkart can fetch as-is."""
    from urllib.parse import quote

    return f"{settings.S3_PUBLIC_BASE_URL}/{quote(key, safe='/')}"


def presign_put(key, content_type):
    """A url the browser can PUT exactly this object to. The browser must send
    the same Content-Type header, or R2 rejects the signature."""
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=PUT_URL_TTL_SECONDS,
        HttpMethod="PUT",
    )


def object_size(key):
    """Size in bytes if the object exists in the bucket, else None. How an
    upload is proven to have actually happened before it is linked."""
    from botocore.exceptions import ClientError

    try:
        head = _client().head_object(Bucket=settings.S3_BUCKET, Key=key)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    return int(head.get("ContentLength") or 0)


_KNOWN_ERRORS = {
    "NoSuchBucket": "the bucket name is wrong, or the token is scoped to a different bucket",
    "InvalidAccessKeyId": "the Access Key ID is wrong",
    "SignatureDoesNotMatch": "the Secret Access Key is wrong",
    "AccessDenied": "the API token lacks Object Read & Write on this bucket",
    "InvalidArgument": "the keys are malformed — see the key-shape note",
}


def probe():
    """A real round trip, step by step, for the cropper's "Test connection":
    write a tiny object, read it back over the PUBLIC url (the step that
    catches a bucket that uploads fine but that nobody can read), delete it.

    Returns [{"step", "ok", "detail"}]; stops at the first failure that makes
    later steps meaningless. Never includes a credential in any detail.
    """
    import uuid

    if not getattr(settings, "OBJECT_STORAGE_READY", False):
        return [{"step": "config", "ok": False,
                 "detail": "Not configured — S3_BUCKET, keys and S3_PUBLIC_BASE_URL are not all set."}]
    problem = credential_problem()
    if problem:
        return [{"step": "config", "ok": False, "detail": problem}]
    steps = [{"step": "config", "ok": True, "detail": f"bucket {settings.S3_BUCKET}"}]

    from botocore.exceptions import ClientError

    client = _client()
    key = f"_probe/{uuid.uuid4().hex}.txt"
    body = b"rudam object storage probe"

    try:
        client.put_object(Bucket=settings.S3_BUCKET, Key=key, Body=body, ContentType="text/plain")
        steps.append({"step": "write", "ok": True, "detail": "uploaded a test file"})
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "?")
        hint = _KNOWN_ERRORS.get(code, "")
        steps.append({"step": "write", "ok": False,
                      "detail": f"R2 refused the upload ({code}){' — ' + hint if hint else ''}"})
        return steps
    except Exception as exc:  # DNS, TLS, timeout
        steps.append({"step": "write", "ok": False,
                      "detail": f"could not reach {settings.S3_ENDPOINT_URL or 'storage'}: {type(exc).__name__}"})
        return steps

    url = public_url(key)
    try:
        import requests
        res = requests.get(url, timeout=20)
        if res.status_code == 200 and res.content == body:
            steps.append({"step": "public read", "ok": True, "detail": url})
        else:
            steps.append({"step": "public read", "ok": False,
                          "detail": f"HTTP {res.status_code} from {settings.S3_PUBLIC_BASE_URL} — the bucket is "
                                    "private or S3_PUBLIC_BASE_URL is not its custom domain. Marketplaces "
                                    "fetch these urls, so listings would show broken images."})
    except Exception as exc:
        steps.append({"step": "public read", "ok": False,
                      "detail": f"could not fetch {settings.S3_PUBLIC_BASE_URL}: {type(exc).__name__}"})

    try:
        client.delete_object(Bucket=settings.S3_BUCKET, Key=key)
        steps.append({"step": "delete", "ok": True, "detail": "test file removed"})
    except Exception as exc:
        steps.append({"step": "delete", "ok": False, "detail": f"could not remove the test file: {type(exc).__name__}"})
    return steps


def move_object(old_key, new_key):
    """Move an object to a new key: copy, verify the copy, then delete the
    original. R2/S3 have no rename, and deleting before the copy is proven
    would risk losing the image. Content type travels with the copy."""
    c = _client()
    c.copy_object(
        Bucket=settings.S3_BUCKET, Key=new_key,
        CopySource={"Bucket": settings.S3_BUCKET, "Key": old_key},
        MetadataDirective="COPY",
    )
    if object_size(new_key) is None:
        raise RuntimeError(f"copy to {new_key} did not land — original left in place")
    c.delete_object(Bucket=settings.S3_BUCKET, Key=old_key)
