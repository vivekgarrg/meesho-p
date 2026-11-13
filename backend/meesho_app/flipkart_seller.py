"""
Flipkart Seller Hub, connected: a business's Seller Hub login held on the
server (encrypted, never handed to a browser), so the app can read its panel —
and, as each request is added, act on it the way the Meesho automation does.

Connecting (Seller Hub asks for an OTP at every login, so a person does it):

  1. POST flipkart-seller/connect/ {username, password}
       GET  /getStateDetails?username=…   (how this account logs in)
       POST /login {authName: "flipkart", username, password, userNameType}
       → Flipkart sends an OTP to the phone. The half-made session is kept.
  2. POST flipkart-seller/otp/ {otp}
       POST /verifyOtp {otp}  → the session cookies (connect.sid, sellerId, is_login, at / rt)

Every read after that goes to Seller Hub's graphql (/napi/graphql) with the
session's cookies, its CSRF token (the XyZ7… cookie, sent back as
fk-csrf-token) and the pickup location (x-location-id). Cookies Flipkart
renews on a response are saved again, and a refresh every few minutes (the
flipkart_refresh command, from the sync's schedule) keeps the session alive.
When Flipkart ends it, the account says EXPIRED: log in again with a new OTP.

Nothing here changes anything on Flipkart: the login, and reads.
"""

import json
import os
import re

import requests
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import FlipkartSellerAccount

BASE = os.environ.get("FLIPKART_SELLER_BASE_URL", "https://seller.flipkart.com").rstrip("/")
USER_AGENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36")
CSRF_COOKIE = "XyZ7pQ9rS2T1uV8wA3bC6dE4fG0h"
TIMEOUT = 25
A = FlipkartSellerAccount

# The dashboard reads (as Seller Hub's home page sends them).
QUERIES = {
    "sales": ("GetBusinessSummarySalesUnits",
              {"fields": ["gross_units", "gross_gmv"], "time_interval": ["today", "yesterday"]},
              "query GetBusinessSummarySalesUnits($fields: [String!]!, $time_interval: [String!]!) {\n"
              "  getBusinessSummarySalesUnitsData(fields: $fields, time_interval: $time_interval) {\n    result\n    __typename\n  }\n}"),
    "impressions": ("GetBusinessSummaryImpressions",
                    {"time_interval": ["impressions_latest", "impressions_prev"]},
                    "query GetBusinessSummaryImpressions($time_interval: [String!]!) {\n"
                    "  getBusinessSummaryImpressionsData(time_interval: $time_interval) {\n    result\n    __typename\n  }\n}"),
    "out_of_stock": ("Selection_getStockWidget",
                     {"filter_by": [{"filter_type": "TEXT_MATCH", "field_name": "stock", "values": ["0"]}]},
                     "query Selection_getStockWidget($filter_by: [GetStockWidgetFilters!]) {\n"
                     "  getStockWidget(filter_by: $filter_by) {\n    aggregations {\n      aggregation_name\n      value\n"
                     "      buckets {\n        key\n        aggregation_count\n        __typename\n      }\n      __typename\n    }\n"
                     "    __typename\n  }\n}"),
}


class FlipkartError(Exception):
    def __init__(self, message, expired=False):
        super().__init__(message)
        self.expired = expired


def _crypto():
    from . import meesho_sync
    return meesho_sync.encrypt, meesho_sync.decrypt


def _http():
    """A fresh HTTP session (one per call) — tests replace this."""
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json, text/javascript, */*; q=0.01",
                      "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8,hi;q=0.7", "X-Requested-With": "XMLHttpRequest",
                      "Origin": BASE, "Referer": f"{BASE}/"})
    return s


def _load(account, s):
    if account.cookies_enc:
        _enc, dec = _crypto()
        for k, v in json.loads(dec(account.cookies_enc)).items():
            s.cookies.set(k, v, domain=".flipkart.com")
    return s


def _save(account, s, fields=None):
    enc, _dec = _crypto()
    # Those loaded from the account first, then any Flipkart set on a response (another domain) over them:
    # the newest of each name wins.
    jar = {c.name: c.value for c in s.cookies if c.domain == ".flipkart.com"}
    jar.update({c.name: c.value for c in s.cookies if c.domain != ".flipkart.com"})
    account.cookies_enc = enc(json.dumps(jar))
    account.save(update_fields=["cookies_enc", "updated_at", *(fields or [])])


def _message(r):
    """What Flipkart said, in a line."""
    try:
        j = r.json()
    except ValueError:
        return (r.text or "").strip()[:200] or f"HTTP {r.status_code}"
    if isinstance(j, dict):
        for k in ("message", "errorMessage", "error_message", "error", "msg", "description"):
            v = j.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()[:200]
            if isinstance(v, dict) and isinstance(v.get("message"), str):
                return v["message"][:200]
    return f"HTTP {r.status_code}"


def _warm(s):
    """Open the panel as the browser does right after logging in: Seller Hub hands out its CSRF
    token (the XyZ7… cookie) there — without it every graphql read is refused."""
    for path in ("/index.html", "/getFeaturesForSeller"):
        try:
            s.get(f"{BASE}{path}", timeout=TIMEOUT, headers={"Referer": f"{BASE}/index.html"})
        except requests.RequestException:
            pass
    return CSRF_COOKIE in {c.name for c in s.cookies}


def _logged_in(s):
    jar = {c.name: c.value for c in s.cookies}
    return str(jar.get("is_login", "")).lower() == "true" or bool(jar.get("sellerId"))


# ── Connecting ───────────────────────────────────────────────────────────────

def start_login(account, password=None):
    """Password step: Flipkart then sends an OTP. Returns the account."""
    enc, dec = _crypto()
    password = password if password is not None else dec(account.password_enc)
    s = _http()
    try:
        s.get(f"{BASE}/getStateDetails", params={"username": account.username, "suppressForgotPassword": "true"}, timeout=TIMEOUT)
        r = s.post(f"{BASE}/login", json={"authName": "flipkart", "username": account.username, "password": password,
                                          "userNameType": "email" if "@" in account.username else "mobileNumber"},
                   timeout=TIMEOUT)
    except requests.RequestException as e:
        raise FlipkartError(f"Couldn't reach Flipkart: {e.__class__.__name__}.")
    if r.status_code >= 400:
        account.status, account.status_message = A.STATUS_FAILED, f"Flipkart refused the login: {_message(r)}"
        account.save(update_fields=["status", "status_message", "updated_at"])
        raise FlipkartError(account.status_message)
    if _logged_in(s):                                             # no OTP asked this time
        _warm(s)
        account.status, account.status_message, account.last_login_at = A.STATUS_ACTIVE, "", timezone.now()
        account.seller_id = {c.name: c.value for c in s.cookies}.get("sellerId", account.seller_id) or ""
        _save(account, s, ["status", "status_message", "last_login_at", "seller_id"])
        return account
    account.status, account.status_message, account.otp_sent_at = A.STATUS_OTP_SENT, "OTP sent to the phone — enter it.", timezone.now()
    _save(account, s, ["status", "status_message", "otp_sent_at"])
    return account


def verify_otp(account, otp):
    """OTP step: finishes the login and keeps the session."""
    otp = re.sub(r"\D", "", str(otp or ""))
    if not otp:
        raise FlipkartError("Enter the OTP Flipkart sent.")
    if account.status != A.STATUS_OTP_SENT:
        raise FlipkartError("Start with the password — no OTP is waiting.")
    s = _load(account, _http())
    try:
        r = s.post(f"{BASE}/verifyOtp", json={"otp": otp}, timeout=TIMEOUT)
    except requests.RequestException as e:
        raise FlipkartError(f"Couldn't reach Flipkart: {e.__class__.__name__}.")
    if r.status_code >= 400 or not _logged_in(s):
        account.status_message = f"OTP not accepted: {_message(r)}"
        account.save(update_fields=["status_message", "updated_at"])
        raise FlipkartError(account.status_message)
    _warm(s)
    jar = {c.name: c.value for c in s.cookies}
    account.status, account.status_message, account.last_login_at = A.STATUS_ACTIVE, "", timezone.now()
    account.seller_id = jar.get("sellerId", "") or account.seller_id
    _save(account, s, ["status", "status_message", "last_login_at", "seller_id"])
    return account


# ── Reading ──────────────────────────────────────────────────────────────────

def graphql(account, op_name, variables, query, s=None):
    """One Seller Hub graphql query, as the panel sends it. Returns its `data`."""
    if account.status != A.STATUS_ACTIVE or not account.cookies_enc:
        raise FlipkartError("Flipkart isn't connected.", expired=account.status == A.STATUS_EXPIRED)
    s = s or _load(account, _http())
    if CSRF_COOKIE not in {c.name for c in s.cookies} and not _warm(s):
        raise FlipkartError("Flipkart didn't hand out its security token (CSRF) — the reads can't be sent. "
                            "Log in again; if it keeps happening, copy the request that sets it from the Network tab.")
    jar = {c.name: c.value for c in s.cookies}
    headers = {"content-type": "application/json", "accept": "*/*", "operation": "query", "operation-name": op_name,
               "x-internal-env-type": "WEB", "fk-csrf-token": jar.get(CSRF_COOKIE, ""), "Referer": f"{BASE}/index.html"}
    if account.location_id:
        headers["x-location-id"] = account.location_id
    try:
        r = s.post(f"{BASE}/napi/graphql", json={"operationName": op_name, "variables": variables, "query": query},
                   headers=headers, timeout=TIMEOUT, allow_redirects=False)
    except requests.RequestException as e:
        raise FlipkartError(f"Couldn't reach Flipkart: {e.__class__.__name__}.")
    # Only a sign that the login itself is gone means "expired"; any other refusal is said as Flipkart said it.
    if r.status_code in (301, 302, 401) or "login" in (r.headers.get("location") or "").lower():
        raise FlipkartError("Flipkart ended the session — log in again with a new OTP.", expired=True)
    if r.status_code >= 400:
        raise FlipkartError(f"Flipkart refused the read (HTTP {r.status_code}): {_message(r)}")
    try:
        body = r.json()
    except ValueError:
        raise FlipkartError("Flipkart sent something other than data — the session may have ended.", expired=True)
    errors = body.get("errors") if isinstance(body, dict) else None
    if errors:
        text = " ".join(str(e.get("message", e)) if isinstance(e, dict) else str(e) for e in errors)[:300]
        if re.search(r"unauth|login|session|forbidden", text, re.I):
            raise FlipkartError("Flipkart ended the session — log in again with a new OTP.", expired=True)
        raise FlipkartError(f"Flipkart said: {text}")
    return (body or {}).get("data") or {}


def _numbers(node, path=()):
    """Every number in a graphql result, as (label, value) — the dashboard's tiles."""
    if isinstance(node, str):
        try:
            node = json.loads(node)
        except ValueError:
            return []
    out = []
    if isinstance(node, dict):
        if "key" in node and "aggregation_count" in node:
            return [(" · ".join([*path, str(node["key"])]), node["aggregation_count"])]
        if "aggregation_name" in node:
            # A stock widget figure: its buckets when it has them ("bring_listing_instock": 1), else its value.
            if node.get("buckets"):
                return _numbers(node["buckets"], path)
            v = node.get("value")
            return [(" · ".join([*path, str(node["aggregation_name"])]), v)] if isinstance(v, (int, float)) and not isinstance(v, bool) else []
        for k, v in node.items():
            if k in ("__typename", "date"):
                continue
            out += _numbers(v, path if k in ("result", "data", "buckets", "aggregations", "numeric") or k.startswith("get") else (*path, k))
    elif isinstance(node, list):
        for v in node:
            out += _numbers(v, path)
    elif isinstance(node, (int, float)) and not isinstance(node, bool):
        out.append((" · ".join(path) or "value", node))
    return out


def refresh(account):
    """Read the dashboard (and so keep the session alive). Marks the account EXPIRED when Flipkart has ended it."""
    s = _load(account, _http())
    summary, problems = {}, []
    for key, (op, variables, query) in QUERIES.items():
        try:
            data = graphql(account, op, variables, query, s=s)
        except FlipkartError as e:
            if e.expired:
                account.status, account.status_message = A.STATUS_EXPIRED, str(e)
                account.last_check_at = timezone.now()
                account.save(update_fields=["status", "status_message", "last_check_at", "updated_at"])
                raise
            problems.append(f"{key}: {e}")
            continue
        summary[key] = [{"label": l, "value": v} for l, v in _numbers(data)]
    account.summary, account.summary_at, account.last_check_at = summary, timezone.now(), timezone.now()
    account.status_message = "; ".join(problems)[:500]
    _save(account, s, ["summary", "summary_at", "last_check_at", "status_message"])
    return account


def refresh_all():
    """Every connected account (the sync's schedule runs this). Returns {business_id: status}."""
    out = {}
    for a in A.objects.filter(status=A.STATUS_ACTIVE):
        try:
            refresh(a)
            out[a.business_id] = "ok"
        except FlipkartError as e:
            out[a.business_id] = "expired" if e.expired else f"error: {e}"
        except Exception as e:                                    # noqa: BLE001 — one account never stops the rest
            out[a.business_id] = f"error: {e.__class__.__name__}"
    return out


# ── API ──────────────────────────────────────────────────────────────────────

def _views():
    from . import views
    return views


def _json(account, request):
    v = _views()
    if not account:
        return {"connected": False, "status": None, "is_admin": v._is_admin(request.user)}
    return {"connected": account.status == A.STATUS_ACTIVE, "status": account.status, "status_message": account.status_message,
            "username": account.username, "seller_id": account.seller_id, "location_id": account.location_id,
            "otp_sent_at": account.otp_sent_at, "last_login_at": account.last_login_at, "last_check_at": account.last_check_at,
            "summary": account.summary, "summary_at": account.summary_at, "is_admin": v._is_admin(request.user)}


def _admin_only(request):
    if not _views()._is_admin(request.user):
        return Response({"error": "Only an admin can connect or change the Flipkart login."}, status=status.HTTP_403_FORBIDDEN)
    return None


@api_view(["GET", "PATCH", "DELETE"])
def account_view(request, business_id):
    """GET where the Flipkart login stands and the last dashboard read; PATCH {location_id}; DELETE disconnects."""
    business = _views().get_authorized_business(request, business_id)
    account = A.objects.filter(business=business).first()
    if request.method == "GET":
        return Response(_json(account, request))
    denied = _admin_only(request)
    if denied:
        return denied
    if not account:
        return Response({"error": "Flipkart isn't connected."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "DELETE":
        account.delete()
        return Response(_json(None, request))
    loc = str(request.data.get("location_id") or "").strip()
    if loc and not re.fullmatch(r"LOC[0-9A-Za-z]{6,60}", loc):
        return Response({"error": "A pickup location id looks like LOC… (letters and numbers)."}, status=status.HTTP_400_BAD_REQUEST)
    account.location_id = loc
    account.save(update_fields=["location_id", "updated_at"])
    return Response(_json(account, request))


@api_view(["POST"])
def connect(request, business_id):
    """{username, password, location_id?} — save the login and send it to Flipkart; an OTP follows."""
    denied = _admin_only(request)
    if denied:
        return denied
    business = _views().get_authorized_business(request, business_id)
    username = re.sub(r"\s+", "", str(request.data.get("username") or ""))
    password = str(request.data.get("password") or "")
    account = A.objects.filter(business=business).first()
    if not username or (not password and not account):
        return Response({"error": "Enter the Seller Hub mobile number (or email) and password."}, status=status.HTTP_400_BAD_REQUEST)
    enc, _dec = _crypto()
    try:
        if account is None:
            account = A(business=business, created_by=request.user)
        account.username = username
        if password:
            account.password_enc = enc(password)
        loc = str(request.data.get("location_id") or "").strip()
        if loc:
            account.location_id = loc
        account.cookies_enc = ""
        account.status, account.status_message = A.STATUS_NEW, ""
        account.save()
        start_login(account, password or None)
    except FlipkartError as e:
        return Response({"error": str(e), **_json(account, request)}, status=status.HTTP_409_CONFLICT)
    except Exception as e:                                        # noqa: BLE001 — e.g. the server's key isn't set
        return Response({"error": f"Couldn't start the login: {e}"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response(_json(account, request))


@api_view(["POST"])
def otp(request, business_id):
    """{otp} — finish the login with the OTP Flipkart sent."""
    denied = _admin_only(request)
    if denied:
        return denied
    business = _views().get_authorized_business(request, business_id)
    account = A.objects.filter(business=business).first()
    if not account:
        return Response({"error": "Start with the password."}, status=status.HTTP_404_NOT_FOUND)
    try:
        verify_otp(account, request.data.get("otp"))
        try:
            refresh(account)
        except FlipkartError:
            pass                                                  # connected; the first read can come later
    except FlipkartError as e:
        return Response({"error": str(e), **_json(account, request)}, status=status.HTTP_409_CONFLICT)
    return Response(_json(account, request))


@api_view(["POST"])
def refresh_view(request, business_id):
    """Read the Seller Hub dashboard now."""
    business = _views().get_authorized_business(request, business_id)
    account = A.objects.filter(business=business).first()
    if not account:
        return Response({"error": "Flipkart isn't connected."}, status=status.HTTP_404_NOT_FOUND)
    try:
        refresh(account)
    except FlipkartError as e:
        return Response({"error": str(e), **_json(account, request)}, status=status.HTTP_409_CONFLICT)
    return Response(_json(account, request))
