"""
Serving the Meesho browser extension as a downloadable, pre-configured zip.

Why build the zip per request instead of committing one: the extension has to
know which server to talk to, and that differs per deployment (rudam.in in
production, 127.0.0.1:8000 while developing). Rather than asking every user to
paste an API URL into Settings, the download is stamped with the origin that
served it — so whatever host you fetched it from is the host it syncs to.

Two files are therefore generated rather than copied verbatim:

  config.js      defines self.ML_CONFIG.apiBase
  manifest.json  the source manifest with that origin added to host_permissions,
                 so the extension's fetches aren't subject to page CORS

Deliberately unauthenticated: a plain <a href> download cannot attach a JWT
header, and the payload is public client code with no secrets in it (credentials
are typed into the extension at runtime and stored only in the user's browser).
"""

import io
import json
import os
import zipfile
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

# The checked-in source folder. The first name that exists wins, so the folder
# can be renamed to something shell-friendly later without breaking downloads.
_CANDIDATE_DIRS = ("Meesho Extension", "meesho-extension", "meesho-lister-extension")

# What the folder is called once unzipped — what the user picks in "Load unpacked".
ZIP_ROOT = "meesho-lister-extension"

# Never ship the nested git repo, editor cruft, or dependency folders.
_EXCLUDE_DIRS = {".git", ".github", "__pycache__", "node_modules", ".idea", ".vscode"}
_EXCLUDE_FILES = {".DS_Store", ".gitignore", "Thumbs.db"}

# Regenerated per download, so a stale copy in the source tree can't override them.
_GENERATED = {"config.js", "manifest.json"}


def _extension_dir():
    """The extension source folder, or None when it isn't deployed."""
    root = Path(settings.BASE_DIR).parent
    for name in _CANDIDATE_DIRS:
        candidate = root / name
        if candidate.is_dir() and (candidate / "manifest.json").is_file():
            return candidate
    return None


# Hosts where plain http is legitimate — a developer's own machine.
_LOCAL_HOSTS = ("127.0.0.1", "localhost", "[::1]", "0.0.0.0")


def _request_is_https(request):
    """
    Whether the browser reached us over TLS.

    request.is_secure() only knows what SECURE_PROXY_SSL_HEADER lets it know, and
    this deployment terminates TLS at Cloudflare while nginx listens on port 80
    and overwrites X-Forwarded-Proto with its own $scheme ("http"). So also read
    the forwarded headers directly — a proxy chain sends a comma-separated list,
    where the first entry is what the client actually spoke.
    """
    if request.is_secure():
        return True
    forwarded = request.META.get("HTTP_X_FORWARDED_PROTO", "")
    if forwarded and forwarded.split(",")[0].strip().lower() == "https":
        return True
    # Cloudflare's own marker, set on every request it proxies.
    if request.META.get("HTTP_CF_VISITOR", "").find('"https"') != -1:
        return True
    return False


def _api_base(request):
    """
    The origin to bake into the download.

    Set EXTENSION_API_BASE in the environment to override entirely (useful when
    the public URL differs from the Host nginx forwards).

    Otherwise: derived from the request, but a non-local host is always given
    https regardless of what the proxy reported. That upgrade is not cosmetic —
    if the extension were configured with an http origin, its CORS preflight
    would be answered with a redirect to https, and browsers refuse to follow
    redirects on a preflight, so every API call would fail.
    """
    override = os.environ.get("EXTENSION_API_BASE", "").strip()
    if override:
        return override.rstrip("/")

    host = request.get_host()
    hostname = host.rsplit(":", 1)[0] if host.count(":") == 1 else host
    is_local = hostname in _LOCAL_HOSTS

    scheme = "https" if (_request_is_https(request) or not is_local) else "http"
    return f"{scheme}://{host}"


def _iter_source_files(base):
    """Every file to ship, as (absolute_path, path_relative_to_base)."""
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(base)
        if any(part in _EXCLUDE_DIRS for part in rel.parts):
            continue
        if path.name in _EXCLUDE_FILES:
            continue
        if str(rel) in _GENERATED:
            continue  # regenerated below
        yield path, rel


def _load_manifest(base):
    with open(base / "manifest.json", "r", encoding="utf-8") as fh:
        return json.load(fh)


def _build_manifest(base, api_base):
    """The source manifest with this deployment's origin granted."""
    manifest = _load_manifest(base)
    hosts = list(manifest.get("host_permissions") or [])
    pattern = f"{api_base}/*"
    if pattern not in hosts:
        hosts.append(pattern)
    manifest["host_permissions"] = hosts
    return manifest


def _build_config(api_base):
    """
    config.js — read by the popup before anything else.

    Assigned to `self` rather than `window` so the same file also works if it is
    ever imported by the service worker, where `window` doesn't exist.
    """
    generated = timezone.now().isoformat(timespec="seconds")
    payload = json.dumps({"apiBase": api_base, "generatedAt": generated}, indent=2)
    return (
        "/**\n"
        " * config.js — GENERATED AT DOWNLOAD TIME. Do not edit by hand;\n"
        f" * re-download from {api_base}/extension to change the server.\n"
        " *\n"
        " * apiBase is the Rudam server this copy of the extension syncs with.\n"
        " */\n"
        f"self.ML_CONFIG = {payload};\n"
    )


def _build_zip(base, api_base):
    buffer = io.BytesIO()
    # Deflate rather than stored: the icons are already compressed but the JS is
    # not, and this keeps the download well under a megabyte.
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, rel in _iter_source_files(base):
            archive.write(path, arcname=str(Path(ZIP_ROOT) / rel))
        archive.writestr(
            str(Path(ZIP_ROOT) / "manifest.json"),
            json.dumps(_build_manifest(base, api_base), indent=2) + "\n",
        )
        archive.writestr(str(Path(ZIP_ROOT) / "config.js"), _build_config(api_base))
    return buffer.getvalue()


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def extension_info(request):
    """
    What the download page needs to render: whether the extension is deployed,
    its version, and how big the download is.
    """
    base = _extension_dir()
    if base is None:
        return Response({
            "available": False,
            "error": "The extension source folder is not present on this server.",
        })

    manifest = _load_manifest(base)
    api_base = _api_base(request)
    payload = _build_zip(base, api_base)

    return Response({
        "available": True,
        "name": manifest.get("name", "Meesho Dynamic Lister"),
        "version": manifest.get("version", ""),
        "description": manifest.get("description", ""),
        "api_base": api_base,
        "zip_root": ZIP_ROOT,
        "size_bytes": len(payload),
        "file_count": sum(1 for _ in _iter_source_files(base)) + len(_GENERATED),
        "download_url": "/api/extension/download/",
    })


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def extension_download(request):
    """The extension as a zip, pre-pointed at this server."""
    base = _extension_dir()
    if base is None:
        return Response(
            {"error": "The extension source folder is not present on this server."},
            status=status.HTTP_404_NOT_FOUND,
        )

    api_base = _api_base(request)
    payload = _build_zip(base, api_base)
    version = _load_manifest(base).get("version", "0")

    response = HttpResponse(payload, content_type="application/zip")
    response["Content-Disposition"] = (
        f'attachment; filename="{ZIP_ROOT}-{version}.zip"'
    )
    response["Content-Length"] = str(len(payload))
    # The zip embeds the requesting origin, so a shared cache must not hand one
    # deployment's build to another.
    response["Cache-Control"] = "no-store"
    return response
