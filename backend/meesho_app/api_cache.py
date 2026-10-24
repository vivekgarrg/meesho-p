"""
Response cache for the business API.

Why: the heavy screens (profit, dashboard, returns analysis, orders grouped…)
recompute from every order/payment row on each load, even when nothing has
changed since the last one. Most of the time nothing has — data only moves when
someone uploads a sheet or edits something — so those answers can be kept and
replayed instantly.

How it stays correct (the part that matters more than the speed):
  · Each business has a *version*. It is part of every cache key, so bumping it
    makes every cached answer for that business unreachable at once — no
    enumerating keys, and a stale write can never be read back.
  · The version is bumped automatically after any successful write
    (POST/PUT/PATCH/DELETE) to /api/business/<id>/… — every upload, order
    update and edit — and whenever a model with a business is saved or deleted
    (covers background jobs and the cross-business pricing mirror). Writes to a
    business profile (/api/businesses/<id>/, which holds the profit switches)
    bump that business too; the browser extension's writes bump everything.
  · The cache sits *behind* authentication: the middleware identifies the user
    and re-runs the same business-access check the views use before serving
    anything, and the user id is in the key. A user who can't see a business can
    never be handed its cached data.
  · Keys also carry the X-Settlement-Mode header and today's date (profit and
    payroll are date-relative), and entries expire after API_CACHE_TTL anyway.
  · Only successful JSON GETs are stored. Files, polls and anything time-of-day
    dependent are on the exclusion list.

It is a shared on-disk cache (not per-process memory) because gunicorn runs
several workers: a bump in one must be seen by all. Any failure in the cache
degrades to "no cache", never to an error.
"""

import hashlib
import logging
import re
import threading
import time
from types import SimpleNamespace

from django.conf import settings
from django.core.cache import caches
from django.db.models.signals import post_delete, post_save
from django.http import HttpResponse
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .permissions import get_authorized_business

log = logging.getLogger(__name__)

_BIZ_RE = re.compile(r"^/api/business/(?P<id>\d+)/(?P<sub>.*)$")
_PROFILE_RE = re.compile(r"^/api/businesses/(?P<id>\d+)/")

# GETs never cached: not deterministic for a given data version.
_NEVER_CACHE_PREFIXES = (
    "cache/",                 # the cache's own status/refresh
    "bulk-labels/today",      # noon-cutoff business day, not a data version
    "employees/salary-due",   # depends on today's date at finer than a day
    # The whole Order Scan desk: it combines several businesses' data, which a
    # per-business cache version can't invalidate; "late" is measured in hours;
    # the day changes at noon; and it changes with every scan anyway.
    "order-scan/",
)
# All-time figures that only change when data does: no date in the key and a long
# expiry, so they are recomputed only after an upload or edit (a version bump).
_LONG_LIVED = {"profit/overall/": 30 * 24 * 3600, "flipkart-overall/": 30 * 24 * 3600}

# POSTs that read or compute but never write — no reason to flush the cache.
_STATELESS_POST_MARKERS = ("parse/", "generate/", "presign/", "check/", "preview/", "lookup/")

_SAFE = {"GET", "HEAD", "OPTIONS"}
_MAX_BYTES = 10 * 1024 * 1024

_state = threading.local()


def _enabled():
    return bool(getattr(settings, "API_CACHE_ENABLED", True))


def _cache():
    return caches["api"]


# ── Versions ─────────────────────────────────────────────────────────────────

def _version(key):
    """Current version for `key`; a missing one (never set, or culled from the
    file store) is created fresh, which safely invalidates anything older."""
    c = _cache()
    v = c.get(key)
    if v is None:
        v = time.time_ns()
        if not c.add(key, v, None):
            v = c.get(key) or v
    return v


def business_version(business_id):
    return _version(f"apiv:b:{business_id}")


def global_version():
    return _version("apiv:g")


def bump(business_id=None):
    """Invalidate one business's cached answers (or everyone's if None)."""
    try:
        _cache().set("apiv:g" if business_id is None else f"apiv:b:{business_id}", time.time_ns(), None)
    except Exception:  # noqa: BLE001 — the cache must never break a write
        log.exception("api_cache: could not bump version")


def note_change(business_id):
    """Called from model signals. Inside a request the bump is deferred to the
    end of it (one write per business, not one per row saved); outside a
    request — a management command, a background job — it happens now."""
    if not business_id:
        return
    if getattr(_state, "pending", None) is not None:
        _state.pending.add(business_id)
    else:
        bump(business_id)


def _on_model_change(sender, instance, **kwargs):
    note_change(getattr(instance, "business_id", None))


def connect_signals():
    """Every model that belongs to a business invalidates that business on
    save/delete. Registered from apps.py's ready()."""
    from django.apps import apps
    from accounts.models import BusinessProfile

    models = list(apps.get_app_config("meesho_app").get_models()) + [BusinessProfile]
    for model in models:
        if any(f.name == "business" for f in model._meta.get_fields()):
            post_save.connect(_on_model_change, sender=model, weak=False,
                              dispatch_uid=f"api_cache_save_{model._meta.label}")
            post_delete.connect(_on_model_change, sender=model, weak=False,
                                dispatch_uid=f"api_cache_del_{model._meta.label}")


# ── Middleware ───────────────────────────────────────────────────────────────

def _authorized_user(request, business_id):
    """The user, if they are authenticated *and* may read this business — the
    same check the views make. None means "don't touch the cache; let the view
    answer" (it will produce the proper 401/403/404)."""
    from rest_framework_simplejwt.authentication import JWTAuthentication
    try:
        res = JWTAuthentication().authenticate(request)
        if not res:
            return None
        user = res[0]
        get_authorized_business(SimpleNamespace(user=user, path=request.path), business_id)
        return user
    except Exception:  # noqa: BLE001
        return None


def _long_ttl(sub):
    return next((ttl for prefix, ttl in _LONG_LIVED.items() if sub.startswith(prefix)), None)


def _cache_key(request, business_id, user, dated=True):
    # The long-lived all-time answers ignore query params, so they share one entry.
    qs = "&".join(sorted(request.META.get("QUERY_STRING", "").split("&"))) if dated else ""
    raw = "|".join([
        request.path, qs,
        request.headers.get("X-Settlement-Mode", "all").lower(),
        str(user.pk),
    ])
    digest = hashlib.sha1(raw.encode()).hexdigest()
    today = time.strftime("%Y%m%d") if dated else "any"
    return f"api:{business_id}:{global_version()}:{business_version(business_id)}:{today}:{digest}"


def _cacheable(response):
    return (
        response.status_code == 200
        and not getattr(response, "streaming", False)
        and "json" in response.get("Content-Type", "")
        and len(response.content) <= _MAX_BYTES
    )


class ApiCacheMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not _enabled() or not request.path.startswith("/api/"):
            return self.get_response(request)

        _state.pending = set()
        try:
            return self._handle(request)
        finally:
            pending, _state.pending = _state.pending, None
            for bid in pending:
                bump(bid)

    def _handle(self, request):
        m = _BIZ_RE.match(request.path)
        key = None
        status = None

        if request.method == "GET" and m and not m.group("sub").startswith(_NEVER_CACHE_PREFIXES):
            try:
                user = _authorized_user(request, int(m.group("id")))
                if user is not None:
                    key = _cache_key(request, m.group("id"), user, dated=_long_ttl(m.group("sub")) is None)
                    if "no-cache" in request.headers.get("Cache-Control", "").lower():
                        status = "BYPASS"
                    else:
                        hit = _cache().get(key)
                        if hit:
                            body, content_type, stored = hit
                            resp = HttpResponse(body, content_type=content_type)
                            resp["X-Cache"] = "HIT"
                            resp["X-Cache-Age"] = str(int(time.time() - stored))
                            return resp
                        status = "MISS"
            except Exception:  # noqa: BLE001
                log.exception("api_cache: lookup failed")
                key = None

        response = self.get_response(request)

        if key is not None:
            try:
                if _cacheable(response):
                    ttl = _long_ttl(m.group("sub")) or int(getattr(settings, "API_CACHE_TTL", 900))
                    _cache().set(key, (response.content, response["Content-Type"], time.time()), ttl)
                response["X-Cache"] = status or "MISS"
            except Exception:  # noqa: BLE001
                log.exception("api_cache: store failed")

        if request.method not in _SAFE and response.status_code < 400:
            self._invalidate_for_write(request)
        return response

    @staticmethod
    def _invalidate_for_write(request):
        path = request.path
        m = _BIZ_RE.match(path)
        if m:
            if request.method == "POST" and any(s in m.group("sub") for s in _STATELESS_POST_MARKERS):
                return
            _state.pending.add(int(m.group("id")))
            return
        p = _PROFILE_RE.match(path)
        if p:  # business profile: holds the profit switches
            _state.pending.add(int(p.group("id")))
            return
        if path.startswith("/api/extension/"):
            bump(None)


# ── Endpoints (Business Profile → "Refresh data") ────────────────────────────

@api_view(["GET"])
def cache_status(request, business_id):
    business = get_authorized_business(request, business_id)
    return Response({
        "enabled": _enabled(),
        "ttl_seconds": int(getattr(settings, "API_CACHE_TTL", 900)),
        # Version is a nanosecond timestamp of the last invalidation, i.e. the
        # last time this business's data (or the cache) was changed.
        "last_change": business_version(business.id) / 1e9 if _enabled() else None,
    })


@api_view(["POST"])
def cache_refresh(request, business_id):
    """Drop this business's cached answers. `{"scope": "all"}` (super admin)
    drops every business's."""
    business = get_authorized_business(request, business_id)
    scope = (request.data.get("scope") if isinstance(request.data, dict) else None) or "business"
    if scope == "all":
        from accounts.models import User
        if request.user.role != User.ROLE_SUPER_ADMIN:
            return Response({"error": "Only a super admin can refresh every business."}, status=403)
        bump(None)
    else:
        bump(business.id)
    return Response({"refreshed": scope, "last_change": business_version(business.id) / 1e9})
