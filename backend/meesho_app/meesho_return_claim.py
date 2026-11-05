"""
Return claims raised on Meesho from the portal — the panel's Support → Returns
form (e.g. "Items missing"), filled from what the app already knows.

The person scans or photographs the parcel: the AWB (or packet / sub-order)
finds the return, and with it the business it belongs to — the claim is
raised on that business's Meesho account only. Meesho's own calls, in the
panel's order:

  fetchAllSubCategory   the claim types under Returns (category 1)
  subcategorySchema     the fields the chosen type asks for
  validateTicketField   each field checked as it is filled (sub-order, AWB, packet…)
  upload/input-attachment   each photo and the unpacking video, stored by Meesho
  createTicket          the claim, with every field and the files' links

Sent with the business's saved session, from Django (as price tickets are).
Every attempt is kept (MeeshoReturnClaim); one Meesho took marks the return
"Claim raised" with its ticket.
"""

import functools
import json
import logging
import os
import shutil
import tempfile
import threading
import time
import uuid

import requests
from django.conf import settings
from django.core.cache import cache
from django.db.models import Q
from django.core.exceptions import PermissionDenied
from django.http import Http404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .meesho_linking import MEESHO_BASE
from .meesho_price_ticket import TicketRefused, _answer, _find, _reason, _session, _short, _ticket_id
from .models import MeeshoAccount, MeeshoPacketLink, MeeshoReturnClaim, ReturnDelivery

API_PATH = "return-claim/"
SUPPORT = "/api/experience/support/"
UPLOAD_PATH = SUPPORT + "api/v1/upload/supplier-support/input-attachment"
CATEGORY_ID = "1"                               # Support → Returns
TIMEOUT = 60
UPLOAD_TIMEOUT = 100                            # a 22 MB video; under gunicorn's 120 s
MAX_UPLOAD = 24 * 1024 * 1024                   # up to 24 MB is sent as it is; Meesho itself may want ≤ 22 MB
CACHE_SECONDS = 6 * 3600

# The fields of "Items missing" (sub-category 2), as the panel sends them — used
# when Meesho's schema can't be read, and to fill in labels and types it leaves out.
KNOWN_FIELDS = [
    {"key": "sub_order_number", "type": "action_single_text_box", "label": "Sub Order Number", "required": True},
    {"key": "awb_number", "type": "action_single_text_box", "label": "AWB Number", "required": True},
    {"key": "packet_state", "type": "drop_down", "label": "State of the packet", "required": True,
     "options": [{"value": "intact", "label": "Intact"}, {"value": "tampered", "label": "Tampered"}]},
    {"key": "barcode_id", "type": "action_single_text_box", "label": "Packet ID", "required": True},
    {"key": "barcode_image_link", "type": "img_file", "label": "Barcode Image", "required": True},
    {"key": "product_image_link", "type": "img_file", "label": "Image of product received", "required": True},
    {"key": "product_reverse_way_bill_link", "type": "action_img_file", "label": "Reverse Waybill", "required": True},
    {"key": "product_openingvideo_link", "type": "video_file", "label": "Unpacking Video", "required": True},
    {"key": "ticket_desc", "type": "text_area", "label": "Description", "required": True},
    {"key": "attachments", "type": "img_file", "label": "Attachments", "required": False},
    {"key": "callback_number", "type": "text_box", "label": "Callback Number", "required": True},
]
KNOWN_BY_KEY = {f["key"]: f for f in KNOWN_FIELDS}
FILE_TYPES = ("img_file", "action_img_file", "video_file", "file")


log = logging.getLogger(__name__)


def _views():
    from . import views
    return views


def reported(view):
    """An unexpected error on these screens: logged in full, and its real reason shown — never a bare 500."""
    @functools.wraps(view)
    def wrapper(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except (Http404, APIException, PermissionDenied):
            raise
        except Exception as exc:                                   # noqa: BLE001
            log.exception("return claim: %s failed", view.__name__)
            return Response({"error": f"Server error ({exc.__class__.__name__}: {str(exc)[:300]}) — it's in the server log.",
                             "code": "server_error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    return wrapper


def _headers(account, sub_category_id=""):
    h = {**_session(account), "content-type": "application/json;charset=UTF-8"}
    h["referer"] = (f"{MEESHO_BASE}/panel/v3/new/experience/{account.supplier_identifier}/support/{CATEGORY_ID}"
                    + (f"/{sub_category_id}/create" if sub_category_id else ""))
    return h


def _post(account, path, body, what, sub_category_id=""):
    try:
        res = requests.post(MEESHO_BASE + SUPPORT + path, headers=_headers(account, sub_category_id), json=body, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise TicketRefused(f"Couldn't reach Meesho ({exc.__class__.__name__}) — try again.", "meesho_unreachable")
    return _answer(res, what)


# ── Reading Meesho's answers ─────────────────────────────────────────────────
# Meesho's schema answers aren't documented: read them leniently — any object
# with a key and a type is a field, any list of {value/label} under it its options.

def _text(d, *keys):
    for k in keys:
        v = d.get(k)
        if isinstance(v, (str, int)) and not isinstance(v, bool) and str(v).strip():
            return str(v).strip()
    return ""


def _walk(obj, depth=0):
    if depth > 8:
        return
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v, depth + 1)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v, depth + 1)


def _options(field):
    for k in ("options", "values", "drop_down_values", "dropdown_values", "choices", "drop_down_options", "items"):
        v = field.get(k)
        if isinstance(v, list) and v and all(isinstance(x, dict) for x in v):
            out = [{"value": _text(x, "value", "key", "id", "option_value"),
                    "label": _text(x, "label", "display_name", "name", "title", "value", "key")} for x in v]
            return [o for o in out if o["value"]]
    return []


# The claim-type picker comes back as a field of the form; it's chosen separately and never sent.
SKIP_KEYS = {"issue"}
# Fields that are only notes on Meesho's form (a sample image, a warning) — shown, never sent.
INFO_TYPES = {"text", "info", "html", "label"}


def parse_fields(answer):
    """The form's fields from a subcategorySchema answer, in Meesho's order."""
    seen, out = set(), []
    for d in _walk(answer):
        key, typ = d.get("key"), d.get("type")
        if not (isinstance(key, str) and isinstance(typ, str)) or key in seen or key in SKIP_KEYS:
            continue
        seen.add(key)
        known = KNOWN_BY_KEY.get(key, {})
        req = d.get("is_mandatory", d.get("mandatory", d.get("required", d.get("is_required"))))
        out.append({
            "key": key, "type": typ,
            "label": _text(d, "label", "title", "display_name", "name") or known.get("label") or key.replace("_", " ").capitalize(),
            "required": bool(req) if req is not None else known.get("required", False),
            "options": _options(d) or known.get("options", []),
            "hint": _text(d, "placeholder", "hint", "help_text", "sub_title", "description"),
            "info": typ in INFO_TYPES,
        })
        if out[-1]["info"]:
            out[-1]["required"] = False
    return out


def sub_categories(account):
    """The claim types under Returns: [{id, label}]."""
    key = f"meesho-claim-subcats:{account.pk}"
    hit = cache.get(key)
    if hit:
        return hit
    answer = _post(account, "fetchAllSubCategory", {"category_id": CATEGORY_ID, "identifier": account.supplier_identifier,
                                                    "is_pre_tp_enabled": False}, "Reading the claim types")
    out, seen = [], set()
    dicts = list(_walk(answer))
    # Entries that say they're sub-categories; else anything with an id and a name.
    picked = [d for d in dicts if "sub_category_id" in d] or [d for d in dicts if "id" in d]
    # Meesho lists most types twice (e.g. 2 and 142, "Item/s are missing in my
    # return"); its own form raises them under the lower id, so that one is kept.
    by_label = {}
    for d in picked:
        sid = _text(d, "sub_category_id", "id")
        label = _text(d, "sub_category_name", "sub_category_title", "name", "title", "display_name", "label")
        if not (sid and label) or sid in seen:
            continue
        seen.add(sid)
        if label not in by_label:
            by_label[label] = {"id": sid, "label": label}
            out.append(by_label[label])
        elif sid.isdigit() and by_label[label]["id"].isdigit() and int(sid) < int(by_label[label]["id"]):
            by_label[label]["id"] = sid
    if out:
        cache.set(key, out, CACHE_SECONDS)
    return out


def schema(account, sub_category_id):
    """The fields a claim type asks for (Meesho's schema; the known form if it can't be read)."""
    key = f"meesho-claim-schema:{account.pk}:{sub_category_id}"
    hit = cache.get(key)
    if hit:
        return hit
    answer = _post(account, "subcategorySchema", {
        "supplier_id": int(account.supplier_id), "identifier": account.supplier_identifier, "sub_category_id": str(sub_category_id),
        "is_pre_tp_enabled": False, "faq_classification_info": {"faq_classification_id": "", "misc": {}}},
        "Reading the claim form", sub_category_id)
    fields = parse_fields(answer)
    if fields:
        cache.set(key, fields, CACHE_SECONDS)
    return fields


def ticket_details(fields, values, labels=None, only=None):
    """
    Meesho's ticket_details for these values, in the form's order: every field
    the form has (files as lists of links, empty when none) — or, to validate,
    only the keys in `only`.
    """
    labels = labels or {}
    out = []
    for f in fields:
        k = f["key"]
        if f.get("info") or (only is not None and k not in only):
            continue
        v = values.get(k)
        if f["type"] in FILE_TYPES:
            v = [u for u in (v if isinstance(v, list) else [v] if v else []) if isinstance(u, str) and u]
        else:
            v = "" if v is None else str(v).strip()
        row = {"key": k, "type": f["type"], "label": f["label"], "value": v}
        if f["type"] == "drop_down":
            row["selectedLabel"] = labels.get(k) or next((o["label"] for o in f.get("options", []) if o["value"] == v), v)
        out.append(row)
    return out


def _errors(answer):
    """
    Meesho's field errors, in words: {"errors": [{"error_message": "Ticket {{ticket_id}} has
    already been raised…", "ticket_id": {"label": 7936…}, "field_name": "awb_number"}]} —
    each {{name}} filled from the error's own values. Returns (message, ticket id or "").
    """
    msgs, ticket = [], ""
    for e in (answer.get("errors") or []) if isinstance(answer, dict) else []:
        if not isinstance(e, dict):
            continue
        text = str(e.get("error_message") or e.get("message") or "")
        for k, v in e.items():
            val = v.get("label") or v.get("value") or v.get(k) if isinstance(v, dict) else v
            if isinstance(val, (str, int)) and f"{{{{{k}}}}}" in text:
                text = text.replace(f"{{{{{k}}}}}", str(val))
            if "ticket" in k and isinstance(val, (str, int)) and not ticket:
                ticket = str(val)
        if text:
            msgs.append(text)
    return " ".join(msgs), ticket


def validate(account, sub_category_id, details):
    """Meesho's check of the fields filled so far: {ok, message, answer}."""
    body = {"supplier_id": str(account.supplier_id), "category_id": CATEGORY_ID, "sub_category_id": str(sub_category_id),
            "ticket_details": details, "supplier_identifier": account.supplier_identifier}
    try:
        answer = _post(account, "validateTicketField", body, "Checking with Meesho", sub_category_id)
    except TicketRefused as e:
        if e.code == "no_session":
            raise
        return {"ok": False, "message": str(e), "answer": e.details.get("meesho_answer")}
    bad = isinstance(answer, dict) and (answer.get("is_valid") is False or answer.get("valid") is False)
    message, ticket = _errors(answer) if bad else ("", "")
    return {"ok": not bad, "message": message or (_reason(answer) if bad else ""), "ticket": ticket, "answer": _short(answer)}


def upload(account, filename, data, content_type):
    """Store one photo / the video with Meesho, as the panel attaches it. Returns its link."""
    h = {k: v for k, v in _headers(account).items() if k != "content-type"}
    try:
        res = requests.post(MEESHO_BASE + UPLOAD_PATH, headers=h, timeout=UPLOAD_TIMEOUT,
                            files={"file": (filename, data, content_type)},
                            data={"is_validation_required": "false", "entity_id": str(account.supplier_id), "entity_type": "SUPPLIER"})
    except requests.RequestException as exc:
        raise TicketRefused(f"Couldn't reach Meesho to upload {filename} ({exc.__class__.__name__}).", "meesho_unreachable")
    body = _answer(res, f"Uploading {filename}")
    url = _find(body, lambda v: isinstance(v, str) and v.startswith("https://") and "storage.googleapis.com" in v)
    if not url:
        raise TicketRefused(f"Meesho took {filename} but sent back no link — {_reason(body) or 'try again'}.", "no_file_link")
    return url


def create_ticket(account, sub_category_id, details, email):
    body = {
        "category_id": CATEGORY_ID, "sub_category_id": str(sub_category_id),
        "supplier_id": str(account.supplier_id), "supplier_identifier": account.supplier_identifier, "supplier_email_id": email,
        "ticket_details": details,
        "faq_classification_info": {"faq_classification_id": "", "supplier_selected_sub_category_id": int(sub_category_id),
                                    "supplier_selected_category_id": int(CATEGORY_ID), "misc": {}},
    }
    return _post(account, "createTicket", body, "Raising the claim", sub_category_id)


# ── The portal's side ────────────────────────────────────────────────────────

def _desk(request, business):
    """
    Every business this person may raise return claims for — the one on screen
    always, and every other business of theirs that can reach returns. Not
    narrowed to the Order Scan desk's chosen businesses: a claim can be for any
    of them.
    """
    from accounts.access import api_access_denied
    v = _views()
    return [b for b in v.accessible_businesses(request, include=business)
            if b.pk == business.pk or not api_access_denied(request.user, b, API_PATH)]


def find_return(ids, code):
    """
    The return a code belongs to: as the desk resolves it (AWB, packet,
    sub-order, order no., the outbound label's AWB), else — as Returns & Claims
    searches — any return whose AWB, packet, sub-order or order number contains
    it, however old (a stored value with spaces or extra characters still matches).
    """
    from .return_desk import _resolve
    r = _resolve(ids, code)
    if r or len(code) < 6:
        return r
    squeezed = "".join(code.split())
    return (ReturnDelivery.objects.filter(business_id__in=ids)
            .filter(Q(awb_number__icontains=squeezed) | Q(packet_id__icontains=squeezed)
                    | Q(suborder_no__icontains=squeezed) | Q(order_no__icontains=squeezed))
            .order_by("-delivered_date", "-return_created_date", "-pk").first())


def _account_for(request, business, business_id):
    """The Meesho account of a business on this person's desk, or a Response saying why not."""
    desk = _desk(request, business)
    try:
        bid = int(business_id)
    except (TypeError, ValueError):
        return None, Response({"error": "Which business is the return from?"}, status=status.HTTP_400_BAD_REQUEST)
    owner = next((b for b in desk if b.pk == bid), None)
    if not owner:
        return None, Response({"error": "That business isn't one of yours."}, status=status.HTTP_403_FORBIDDEN)
    account = MeeshoAccount.objects.filter(business=owner).select_related("business").first()
    if not account or account.status != MeeshoAccount.STATUS_ACTIVE:
        return None, Response({"error": f"{owner.name}'s Meesho account isn't connected — connect it under Meesho → Settings.",
                               "code": "no_session"}, status=status.HTTP_409_CONFLICT)
    return account, None


def _refused(e):
    return Response({"error": str(e), "code": e.code}, status=status.HTTP_409_CONFLICT if e.code == "no_session"
                    else status.HTTP_502_BAD_GATEWAY)


def _claim_json(c):
    return {"id": c.pk, "business_id": c.business_id, "business_name": c.business.name, "sub_order_no": c.sub_order_no,
            "awb": c.awb_number, "packet_id": c.packet_id, "sub_category": c.sub_category, "status": c.status,
            "ticket": c.ticket, "message": c.message, "at": c.created_at, "attempts": c.attempts,
            "finished_at": c.finished_at, "pod_attached": bool(c.pod_meesho_url),
            "forced": c.forced, "force_reason": c.force_reason,
            "by": c.created_by.username if c.created_by else None}


def duplicate_of(business_id, sub_order, ret=None):
    """
    Why a claim for this return would be a duplicate: one raised (or on its way)
    from here, or — as Returns & Claims records it — one raised on the panel.
    Returns {"why", "claim"?} or None. A claim that failed doesn't count.
    """
    c = (MeeshoReturnClaim.objects.filter(business_id=business_id, sub_order_no=sub_order,
                                          status__in=MeeshoReturnClaim.ACTIVE_STATUSES)
         .select_related("business", "created_by").order_by("-created_at").first())
    if c:
        when = timezone.localtime(c.created_at).strftime("%-d %b")
        what = "raised" if c.status == MeeshoReturnClaim.STATUS_OK else "already being raised"
        return {"why": f"A claim for this return was {what} on {when}" + (f" — ticket {c.ticket}" if c.ticket else "")
                       + (f" ({c.sub_category})" if c.sub_category else "") + ".", "claim": _claim_json(c)}
    if ret is not None and ret.claim_status in (ReturnDelivery.CLAIM_RAISED, ReturnDelivery.CLAIM_APPROVED,
                                                ReturnDelivery.CLAIM_REJECTED):
        return {"why": f"Returns & Claims says a claim was already raised for this return"
                       + (f" — {ret.claim_reference}" if ret.claim_reference else "") + "."}
    return None


def _return_json(r, names):
    from .meesho_images import photo_map
    photo, fallback = photo_map([r]).get((r.business_id, r.suborder_no), (None, None))
    forward_packet = (MeeshoPacketLink.objects.filter(business_id=r.business_id, sub_order_no=r.suborder_no)
                      .values_list("packet_id", flat=True).first())
    account = MeeshoAccount.objects.filter(business_id=r.business_id).first()
    claims = MeeshoReturnClaim.objects.filter(business_id=r.business_id, sub_order_no=r.suborder_no).select_related("business", "created_by")
    scan = r.desk_scans.filter(damaged=True).first() if hasattr(r, "desk_scans") else None
    return {
        "id": r.pk, "business_id": r.business_id, "business_name": names.get(r.business_id, ""),
        "connected": bool(account and account.status == MeeshoAccount.STATUS_ACTIVE),
        "sub_order_no": r.suborder_no, "order_no": r.order_no, "awb": r.awb_number,
        "packet_id": r.packet_id or forward_packet or "",
        "sku": r.sku, "product_name": r.product_name, "variation": r.variation, "qty": r.qty,
        "type_of_return": r.type_of_return, "return_reason": r.return_reason, "detailed_return_reason": r.detailed_return_reason,
        "courier": r.courier_partner, "delivered_date": r.delivered_date, "stage": r.stage,
        "claim_status": r.claim_status, "claim_reference": r.claim_reference,
        "image_url": photo, "image_fallback_url": fallback,
        "claims": [_claim_json(c) for c in claims[:10]],
        "duplicate": duplicate_of(r.business_id, r.suborder_no, r),
        "pod_url": r.proof_of_delivery or "",
        # Flagged damaged / tampered on Return Scan — the claim starts from that.
        "damaged": bool(scan), "damage_note": scan.damage_note if scan else "",
    }


@api_view(["GET"])
@reported
def claim_lookup(request, business_id):
    """
    The return a scanned / typed code belongs to — ?code= (repeatable: every
    code read off the waybill photo is tried, best first). AWB, packet id,
    sub-order or order number, across every business on this person's desk.
    """
    v = _views()
    business = v.get_authorized_business(request, business_id)
    desk = _desk(request, business)
    ids, names = [b.pk for b in desk], {b.pk: b.name for b in desk}
    codes = [(v._order_scan_code(c) or "").strip().upper() for c in request.GET.getlist("code")]
    for code in [c for c in codes if c][:12]:
        r = find_return(ids, code)
        if r:
            return Response({"found": True, "matched_code": code, "return": _return_json(r, names)})
    searched = ", ".join(names.values()) or "none"
    return Response({"found": False, "searched": list(names.values()), "codes": codes[:12],
                     "error": f"No return matches {', '.join(c for c in codes if c)[:120] or 'that'} in {searched}. "
                              f"If it's another business's return, you need access to that business; if it's new, "
                              f"upload the latest returns export (or let the Meesho returns sync run)."},
                    status=status.HTTP_404_NOT_FOUND)


@api_view(["GET"])
@reported
def claim_options(request, business_id):
    """?business_id= — that business's claim types, and (with &sub=) the fields of one."""
    business = _views().get_authorized_business(request, business_id)
    account, err = _account_for(request, business, request.GET.get("business_id"))
    if err:
        return err
    try:
        out = {"business_id": account.business_id, "business_name": account.business.name, "sub_categories": sub_categories(account)}
        sub = request.GET.get("sub")
        if sub:
            fields = schema(account, sub)
            out["fields"] = fields or KNOWN_FIELDS
            out["schema_read"] = bool(fields)
    except TicketRefused as e:
        return _refused(e)
    return Response(out)


@api_view(["POST"])
@reported
def claim_validate(request, business_id):
    """{business_id, sub_category_id, values: {key: value}, keys: [the keys to check]} → Meesho's check."""
    business = _views().get_authorized_business(request, business_id)
    d = request.data if isinstance(request.data, dict) else {}
    account, err = _account_for(request, business, d.get("business_id"))
    if err:
        return err
    sub = str(d.get("sub_category_id") or "")
    try:
        fields = schema(account, sub) or KNOWN_FIELDS
        details = ticket_details(fields, d.get("values") or {}, d.get("labels") or {}, only=set(d.get("keys") or []))
        return Response(validate(account, sub, details))
    except TicketRefused as e:
        return _refused(e)


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
@reported
def claim_upload(request, business_id):
    """multipart {business_id, file} — store a photo or the video with Meesho. Returns {url}."""
    business = _views().get_authorized_business(request, business_id)
    account, err = _account_for(request, business, request.data.get("business_id"))
    if err:
        return err
    f = request.FILES.get("file")
    if not f:
        return Response({"error": "No file."}, status=status.HTTP_400_BAD_REQUEST)
    if f.size > MAX_UPLOAD:
        return Response({"error": f"{f.name} is {f.size / 1048576:.1f} MB — over 24 MB has to be compressed first."},
                        status=status.HTTP_400_BAD_REQUEST)
    try:
        url = upload(account, f.name, f.read(), f.content_type or "application/octet-stream")
    except TicketRefused as e:
        return _refused(e)
    return Response({"url": url, "name": f.name, "size": f.size})


# ── Uploads in pieces ────────────────────────────────────────────────────────
# A 20 MB video in one request from a phone, through Cloudflare (which cuts a
# request at ~100 s) and gunicorn (120 s), then on to Meesho, fails on a slow
# line. So the browser sends it in small pieces (each retried on its own); the
# server joins them and sends the file to Meesho in the background; the page
# asks until it's there. Kept on disk, where every gunicorn worker sees it.

CHUNK_MAX = 4 * 1024 * 1024
# Kept beside the app (not /tmp), where the Sidekiq worker's Django command finds them too — both run
# as the same user. If that folder can't be written (left owned by root by a deploy run as root), the
# user's home is used instead.
UPLOAD_ROOT = os.environ.get("MEESHO_CLAIM_UPLOADS") or os.path.join(str(settings.BASE_DIR), "claim_uploads")
UPLOAD_FALLBACK = os.path.join(os.path.expanduser("~"), "meesho-claim-uploads")


def _writable(path):
    try:
        os.makedirs(path, exist_ok=True)
        probe = os.path.join(path, f".probe-{uuid.uuid4().hex}")
        with open(probe, "w") as fh:
            fh.write("ok")
        os.remove(probe)
        return True
    except OSError:
        return False


def _roots():
    """Where uploads go (first writable) and every place one may already be."""
    return [r for r in dict.fromkeys([UPLOAD_ROOT, UPLOAD_FALLBACK]) if r]


def _new_root():
    for r in _roots():
        if _writable(r):
            return r
    raise OSError(f"no writable folder for claim files (tried {', '.join(_roots())})")
UPLOAD_KEEP_SECONDS = 3 * 24 * 3600
# A phone's unpacking video, before it is compressed on the server.
MAX_RAW_VIDEO = 700 * 1024 * 1024


def _upload_dir(upload_id):
    if not upload_id or not all(c in "0123456789abcdef" for c in str(upload_id)) or len(str(upload_id)) != 32:
        return None
    for root in _roots():
        path = os.path.join(root, str(upload_id))
        if os.path.isdir(path):
            return path
    return os.path.join(_roots()[0], str(upload_id))


def _read_json(path, default=None):
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def _write_json(path, data):
    tmp = f"{path}.{uuid.uuid4().hex}.tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh)
    os.replace(tmp, path)


def _sweep_uploads():
    """Uploads left over from days ago — gone."""
    for root in _roots():
        try:
            for name in os.listdir(root):
                path = os.path.join(root, name)
                if time.time() - os.path.getmtime(path) > UPLOAD_KEEP_SECONDS:
                    shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass


def _own_upload(request, upload_id):
    """(folder, meta) of an upload this person started, or (None, Response)."""
    folder = _upload_dir(upload_id)
    meta = _read_json(os.path.join(folder, "meta.json")) if folder else None
    if not meta or meta.get("user_id") != request.user.pk:
        return None, Response({"error": "That upload isn't here any more — add the file again."}, status=status.HTTP_404_NOT_FOUND)
    return folder, meta


@api_view(["POST"])
@reported
def claim_upload_start(request, business_id):
    """{business_id, name, size, content_type} → {upload_id, chunk_size}."""
    business = _views().get_authorized_business(request, business_id)
    d = request.data if isinstance(request.data, dict) else {}
    account, err = _account_for(request, business, d.get("business_id"))
    if err:
        return err
    try:
        size = int(d.get("size") or 0)
    except (TypeError, ValueError):
        size = 0
    name = os.path.basename(str(d.get("name") or "file"))[:150] or "file"
    if size <= 0:
        return Response({"error": "That file is empty."}, status=status.HTTP_400_BAD_REQUEST)
    content_type = str(d.get("content_type") or "application/octet-stream")[:100]
    limit = MAX_RAW_VIDEO if content_type.startswith("video/") else MAX_UPLOAD
    if size > limit:
        return Response({"error": f"{name} is {size / 1048576:.0f} MB — at most {limit // 1048576} MB."},
                        status=status.HTTP_400_BAD_REQUEST)
    _sweep_uploads()
    upload_id = uuid.uuid4().hex
    folder = os.path.join(_new_root(), upload_id)
    os.makedirs(folder, exist_ok=True)
    _write_json(os.path.join(folder, "meta.json"), {
        "user_id": request.user.pk, "account_id": account.pk, "name": name, "size": size,
        "content_type": content_type})
    return Response({"upload_id": upload_id, "chunk_size": CHUNK_MAX // 2})


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
@reported
def claim_upload_chunk(request, business_id, upload_id):
    """multipart {index, file} — one piece of the file."""
    _views().get_authorized_business(request, business_id)
    folder, meta = _own_upload(request, upload_id)
    if not folder:
        return meta
    try:
        index = int(request.data.get("index"))
    except (TypeError, ValueError):
        return Response({"error": "Which piece is this?"}, status=status.HTTP_400_BAD_REQUEST)
    piece = request.FILES.get("file")
    if not piece or index < 0 or index > 10_000 or piece.size > CHUNK_MAX:
        return Response({"error": "That piece is missing or too big."}, status=status.HTTP_400_BAD_REQUEST)
    path = os.path.join(folder, f"part-{index:05d}")
    with open(path + ".tmp", "wb") as fh:
        for block in piece.chunks():
            fh.write(block)
    os.replace(path + ".tmp", path)
    return Response({"index": index, "size": piece.size})


def _send_upload(folder, meta, parts):
    """In the background: join the pieces and store the file with Meesho."""
    from django.db import connection
    status_path = os.path.join(folder, "status.json")
    try:
        data = b"".join(open(os.path.join(folder, f"part-{i:05d}"), "rb").read() for i in range(parts))
        if len(data) != meta["size"]:
            raise TicketRefused(f"Only {len(data)} of {meta['size']} bytes arrived — add the file again.", "incomplete")
        account = MeeshoAccount.objects.select_related("business").get(pk=meta["account_id"])
        url = upload(account, meta["name"], data, meta["content_type"])
        _write_json(status_path, {"state": "done", "url": url, "name": meta["name"], "size": meta["size"]})
    except TicketRefused as e:
        _write_json(status_path, {"state": "error", "error": str(e)})
    except Exception as e:                                         # noqa: BLE001 — told to the page, never lost
        _write_json(status_path, {"state": "error", "error": f"Sending it to Meesho failed ({e.__class__.__name__}) — try again."})
    finally:
        for i in range(parts):
            try:
                os.remove(os.path.join(folder, f"part-{i:05d}"))
            except OSError:
                pass
        if threading.current_thread() is not threading.main_thread():
            connection.close()                                     # this thread's own connection


def _in_background(fn, *args):
    threading.Thread(target=fn, args=args, daemon=True).start()


@api_view(["POST"])
@reported
def claim_upload_finish(request, business_id, upload_id):
    """{parts} — every piece is here: send the file to Meesho (in the background). → {state}."""
    _views().get_authorized_business(request, business_id)
    folder, meta = _own_upload(request, upload_id)
    if not folder:
        return meta
    try:
        parts = int((request.data or {}).get("parts"))
    except (TypeError, ValueError):
        return Response({"error": "How many pieces?"}, status=status.HTTP_400_BAD_REQUEST)
    missing = [i for i in range(parts) if not os.path.exists(os.path.join(folder, f"part-{i:05d}"))]
    if parts <= 0 or missing:
        return Response({"error": f"{len(missing)} piece(s) didn't arrive — try again.", "missing": missing[:50]},
                        status=status.HTTP_400_BAD_REQUEST)
    status_path = os.path.join(folder, "status.json")
    if (_read_json(status_path) or {}).get("state") in ("sending", "done", "complete"):
        return Response(_read_json(status_path), status=status.HTTP_202_ACCEPTED)
    if (request.data or {}).get("send") is False:                  # for a queued claim: the worker sends it
        _write_json(status_path, {"state": "complete", "parts": parts})
        return Response({"state": "complete"}, status=status.HTTP_202_ACCEPTED)
    _write_json(status_path, {"state": "sending"})
    _in_background(_send_upload, folder, meta, parts)
    return Response({"state": "sending"}, status=status.HTTP_202_ACCEPTED)


@api_view(["GET"])
@reported
def claim_upload_status(request, business_id, upload_id):
    """{state: sending | done (url) | error (error)}."""
    _views().get_authorized_business(request, business_id)
    folder, meta = _own_upload(request, upload_id)
    if not folder:
        return meta
    return Response(_read_json(os.path.join(folder, "status.json")) or {"state": "waiting"})


@api_view(["GET", "POST"])
@parser_classes([JSONParser])
@reported
def claims(request, business_id):
    """
    GET  — the claims raised lately, on every business of this desk (?q= sub-order / AWB).
    POST — raise one: {business_id, return_id?, sub_category_id, sub_category, values: {key: value},
           labels: {key: selected label}, email}. Every field the form has is sent; files as
           the links their upload gave.
    """
    v = _views()
    business = v.get_authorized_business(request, business_id)
    if request.method == "GET":
        ids = [b.pk for b in _desk(request, business)]
        qs = MeeshoReturnClaim.objects.filter(business_id__in=ids).select_related("business", "created_by")
        q = (request.GET.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(sub_order_no__icontains=q) | Q(awb_number__icontains=q) | Q(ticket__icontains=q))
        return Response({"claims": [_claim_json(c) for c in qs[:100]]})

    d = request.data if isinstance(request.data, dict) else {}
    account, err = _account_for(request, business, d.get("business_id"))
    if err:
        return err
    sub = str(d.get("sub_category_id") or "").strip()
    values = d.get("values") if isinstance(d.get("values"), dict) else {}
    files = d.get("files") if isinstance(d.get("files"), dict) else {}
    email = str(d.get("email") or "").strip()
    if not sub:
        return Response({"error": "Choose what the claim is for."}, status=status.HTTP_400_BAD_REQUEST)
    if "@" not in email:
        return Response({"error": "An email for Meesho's reply is needed."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        fields = schema(account, sub) or KNOWN_FIELDS
    except TicketRefused as e:
        return _refused(e)
    # Files: links already with Meesho (in values), or uploads to this server (in files) the worker sends.
    uploads = {}
    for key, ids in files.items():
        ids = [i for i in (ids if isinstance(ids, list) else [ids]) if _upload_dir(i)]
        metas = [(i, _read_json(os.path.join(_upload_dir(i), "meta.json"))) for i in ids]
        if any(not m or m.get("user_id") != request.user.pk for _, m in metas):
            return Response({"error": "A file isn't here any more — add it again."}, status=status.HTTP_400_BAD_REQUEST)
        uploads[str(key)] = [{"upload_id": i, "name": m["name"], "content_type": m["content_type"], "size": m["size"]} for i, m in metas]
    missing = [f["label"] for f in fields if f["required"] and not f.get("info")
               and not values.get(f["key"]) and not uploads.get(f["key"])]
    if missing:
        return Response({"error": "Fill in: " + ", ".join(missing) + ".", "code": "missing", "missing": missing},
                        status=status.HTTP_400_BAD_REQUEST)
    sub_order = str(values.get("sub_order_number") or "").strip()
    ret = ReturnDelivery.objects.filter(pk=d.get("return_id"), business=account.business).first() if d.get("return_id") else None
    if ret is None and sub_order:
        ret = ReturnDelivery.objects.filter(business=account.business, suborder_no=sub_order).first()
    dup = duplicate_of(account.business_id, sub_order, ret)
    force_reason = str(d.get("force_reason") or "").strip()[:300]
    forced = bool(dup) and bool(d.get("force"))
    if dup and not forced:
        return Response({"error": dup["why"], "code": "duplicate", "duplicate": dup}, status=status.HTTP_409_CONFLICT)
    if forced and len(force_reason) < 3:
        return Response({"error": "Say why it's raised again — it's kept with the claim.", "code": "force_reason"},
                        status=status.HTTP_400_BAD_REQUEST)
    claim = MeeshoReturnClaim.objects.create(
        business=account.business, return_delivery=ret, sub_order_no=sub_order[:100],
        awb_number=str(values.get("awb_number") or "")[:100], packet_id=str(values.get("barcode_id") or "")[:150],
        sub_category_id=sub[:20], sub_category=str(d.get("sub_category") or "")[:200],
        description=str(values.get("ticket_desc") or ""), created_by=request.user,
        values=values, labels=d.get("labels") or {}, files=uploads, email=email[:200],
        callback_number=str(values.get("callback_number") or "")[:20], packet_state=str(values.get("packet_state") or "")[:40],
        return_snapshot=_snapshot(ret), pod_url=(ret.proof_of_delivery if ret else "") or "",
        status=MeeshoReturnClaim.STATUS_QUEUED, message="Queued — raised in the background.",
        forced=forced, force_reason=force_reason if forced else "",
        events=[_event("queued", f"by {request.user.username}")]
               + ([_event("forced", f"by {request.user.username} — {dup['why']} Reason: {force_reason}")] if forced else []))
    queued = queue_claim(claim)
    return Response({"claim": _claim_json(claim), "queued": queued}, status=status.HTTP_202_ACCEPTED)


@api_view(["POST"])
@reported
def claim_retry(request, business_id, claim_id):
    """A claim that failed: try it again (its files, if any, are still here)."""
    business = _views().get_authorized_business(request, business_id)
    ids = [b.pk for b in _desk(request, business)]
    c = MeeshoReturnClaim.objects.filter(pk=claim_id, business_id__in=ids).select_related("business", "created_by").first()
    if not c:
        return Response({"error": "No such claim."}, status=status.HTTP_404_NOT_FOUND)
    if c.status != MeeshoReturnClaim.STATUS_FAILED:
        return Response({"error": "Only a failed claim can be tried again."}, status=status.HTTP_400_BAD_REQUEST)
    dup = duplicate_of(c.business_id, c.sub_order_no)
    if dup and not c.forced and not (request.data or {}).get("force"):
        return Response({"error": dup["why"], "code": "duplicate"}, status=status.HTTP_409_CONFLICT)
    c.status, c.message, c.error_code, c.attempts = MeeshoReturnClaim.STATUS_QUEUED, "Queued again.", "", 0
    c.events = (c.events or []) + [_event("retry", f"by {request.user.username}")]
    c.save(update_fields=["status", "message", "error_code", "attempts", "events"])
    return Response({"claim": _claim_json(c), "queued": queue_claim(c)}, status=status.HTTP_202_ACCEPTED)


# ── The worker's side: raising a queued claim ───────────────────────────────

CLAIM_JOB = "MeeshoClaimJob"
MAX_ATTEMPTS = 6
RETRY_IN = [60, 300, 900, 1800, 3600]           # after each failed try that may pass
FILES_WAIT = 30                                  # the page is still sending files
FILES_GIVE_UP = 6 * 3600                         # …for this long, at most
FILES_STALLED = 20 * 60                          # no new piece for this long: the page stopped sending
MEESHO_VIDEO_MAX = 22 * 1024 * 1024              # Meesho's own cap
VIDEO_TARGET = int(21.5 * 1024 * 1024)
POD_MAX = 15 * 1024 * 1024


def _event(step, note=""):
    return {"at": timezone.now().isoformat(), "step": step, "note": str(note)[:500]}


def _snapshot(ret):
    if not ret:
        return {}
    keep = ("suborder_no", "order_no", "awb_number", "packet_id", "sku", "product_name", "variation", "qty", "category",
            "dispatch_date", "return_created_date", "delivered_date", "type_of_return", "sub_type", "courier_partner",
            "return_reason", "detailed_return_reason", "proof_of_delivery", "stage", "claim_status")
    return {k: (str(getattr(ret, k)) if getattr(ret, k, None) is not None else None) for k in keep}


def queue_claim(claim):
    """Hand the claim to the Sidekiq worker. False when the job queue can't be reached (it stays queued; Retry)."""
    from . import meesho_sync
    try:
        meesho_sync.enqueue(CLAIM_JOB, [claim.pk, 1])
        return True
    except Exception as exc:                                       # noqa: BLE001
        claim.status, claim.error_code = MeeshoReturnClaim.STATUS_FAILED, "no_queue"
        claim.message = f"The background worker's queue (Redis) can't be reached — press Retry once it's back. ({exc.__class__.__name__})"
        claim.events = (claim.events or []) + [_event("failed", claim.message)]
        claim.save(update_fields=["status", "error_code", "message", "events"])
        return False


class _Wait(Exception):
    pass


class _Passing(Exception):
    """Something that may work next time (Meesho busy or unreachable, a network blip)."""


def _joined(upload_id):
    """(path, meta) of an upload whose every piece is here — joined into one file
    on disk, never in memory (a phone video can be hundreds of MB) — or raise _Wait."""
    folder = _upload_dir(upload_id)
    meta = _read_json(os.path.join(folder, "meta.json")) if folder else None
    st = _read_json(os.path.join(folder, "status.json")) if folder else None
    if not meta:
        raise TicketRefused("A file of this claim was lost on the server — raise the claim again with it.", "file_lost")
    if not st or st.get("state") != "complete":
        # Still arriving — unless nothing has come for a while: the page was closed (or the phone slept) mid-way.
        try:
            last = max(os.path.getmtime(os.path.join(folder, n)) for n in os.listdir(folder))
        except (OSError, ValueError):
            last = time.time()
        if time.time() - last > FILES_STALLED:
            raise TicketRefused(f"{meta['name']} stopped arriving {int((time.time() - last) // 60)} minutes ago — the page was "
                                f"closed (or the phone slept) before it finished. Raise the claim again with the file.",
                                "files_stalled")
        raise _Wait()
    whole = os.path.join(folder, "whole")
    if not os.path.exists(whole):
        parts = int(st.get("parts") or 0)
        tmp = f"{whole}.{uuid.uuid4().hex}.tmp"
        try:
            with open(tmp, "wb") as out:
                for i in range(parts):
                    with open(os.path.join(folder, f"part-{i:05d}"), "rb") as fh:
                        shutil.copyfileobj(fh, out, 1024 * 1024)
        except OSError:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise TicketRefused(f"{meta['name']}: a piece of it is missing on the server — raise the claim again.", "file_lost")
        os.replace(tmp, whole)
        for i in range(parts):                                     # the pieces aren't needed twice over
            try:
                os.remove(os.path.join(folder, f"part-{i:05d}"))
            except OSError:
                pass
    size = os.path.getsize(whole)
    if size != meta["size"]:
        raise TicketRefused(f"{meta['name']}: only {size} of {meta['size']} bytes arrived — raise the claim again.", "file_lost")
    return whole, meta


def _read(path):
    with open(path, "rb") as fh:
        return fh.read()


def compress_video(src, name):
    """Shrink the video at path `src` under Meesho's 22 MB cap with ffmpeg: (bytes, new name)."""
    import subprocess
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg:
        raise TicketRefused("The video is over 22 MB and this server has no ffmpeg to compress it — install ffmpeg "
                            "(apt-get install ffmpeg), then press Retry.", "no_ffmpeg")
    with tempfile.TemporaryDirectory(dir=os.path.dirname(src)) as tmp:
        seconds = 60.0
        if ffprobe:
            out = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", src],
                                 capture_output=True, text=True, timeout=60)
            try:
                seconds = max(1.0, float(out.stdout.strip()))
            except ValueError:
                pass
        kbps = max(250, min(4000, int(VIDEO_TARGET * 8 * 0.92 / seconds / 1000) - 64))
        for attempt in range(3):
            dst = os.path.join(tmp, f"out{attempt}.mp4")
            run = subprocess.run([ffmpeg, "-y", "-v", "error", "-i", src, "-vf", "scale='min(1280,iw)':-2", "-r", "24",
                                  "-c:v", "libx264", "-preset", "veryfast", "-b:v", f"{kbps}k", "-maxrate", f"{int(kbps * 1.2)}k",
                                  "-bufsize", f"{kbps * 2}k", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", dst],
                                 capture_output=True, text=True, timeout=1800)
            if run.returncode != 0:
                raise TicketRefused(f"Couldn't compress the video: {(run.stderr or '').strip()[-300:]}", "bad_video")
            size = os.path.getsize(dst)
            if size <= VIDEO_TARGET:
                with open(dst, "rb") as fh:
                    return fh.read(), os.path.splitext(name)[0] + ".mp4"
            kbps = max(150, int(kbps * VIDEO_TARGET / size * 0.9))
    raise TicketRefused("Couldn't get the video under 22 MB — record a shorter one.", "bad_video")


def _fetch_pod(url):
    """The courier's proof of delivery: (bytes, file name, content type), or None."""
    try:
        res = requests.get(url, timeout=30, allow_redirects=True, stream=True, headers={"user-agent": "Mozilla/5.0"})
        if res.status_code != 200:
            return None
        data = res.raw.read(POD_MAX + 1, decode_content=True)
        if not data or len(data) > POD_MAX:
            return None
        ctype = (res.headers.get("content-type") or "").split(";")[0].strip().lower()
        if data[:4] == b"%PDF":
            ctype = "application/pdf"
        elif data[:3] == b"\xff\xd8\xff":
            ctype = "image/jpeg"
        elif data[:8] == b"\x89PNG\r\n\x1a\n":
            ctype = "image/png"
        if ctype not in ("application/pdf", "image/jpeg", "image/png", "image/jpg", "image/webp"):
            return None                                            # a tracking web page, not a document
        ext = {"application/pdf": ".pdf", "image/png": ".png", "image/webp": ".webp"}.get(ctype, ".jpg")
        return data, f"proof-of-delivery{ext}", ctype
    except requests.RequestException:
        return None


def _passing(e):
    """Whether a refusal may pass on its own (try again later) — or needs a person."""
    return e.code in ("meesho_unreachable",) or (e.details.get("meesho_http") or 0) >= 500 or e.details.get("meesho_http") == 429


def process_claim(claim_id, attempt=1):
    """
    Raise one queued claim: send its files (compressing a big video), attach the
    return's POD, raise the ticket. Returns {"next": "done" | "wait" | "retry" | "failed", "in": seconds}.
    Each file sent is remembered, so a retry picks up where the last try stopped.
    """
    claim = MeeshoReturnClaim.objects.select_related("business", "return_delivery").filter(pk=claim_id).first()
    if not claim or claim.status in (MeeshoReturnClaim.STATUS_OK, MeeshoReturnClaim.STATUS_FAILED):
        return {"next": "done"}
    now = timezone.now()
    claim.status, claim.attempts = MeeshoReturnClaim.STATUS_WORKING, max(claim.attempts, attempt)
    claim.started_at = claim.started_at or now
    claim.message = "Raising it on Meesho…"
    claim.save(update_fields=["status", "attempts", "started_at", "message"])

    def save(*fields):
        claim.save(update_fields=list(fields))

    def note(step, text=""):
        claim.events = (claim.events or []) + [_event(step, text)]
        save("events")

    try:
        account = MeeshoAccount.objects.select_related("business").filter(business=claim.business).first()
        if not account or account.status != MeeshoAccount.STATUS_ACTIVE:
            raise TicketRefused(f"{claim.business.name}'s Meesho account isn't connected — log in, then Retry.", "no_session")
        fields = schema(account, claim.sub_category_id) or KNOWN_FIELDS

        # 1. Every file to Meesho (a big video compressed first). Waits while the page is still sending.
        values = dict(claim.values or {})
        for key, items in (claim.files or {}).items():
            for item in items:
                if item.get("url"):
                    continue
                try:
                    path, meta = _joined(item["upload_id"])
                except _Wait:
                    if (now - claim.created_at).total_seconds() > FILES_GIVE_UP:
                        raise TicketRefused("The files never finished arriving from the phone — raise the claim again.", "files_missing")
                    claim.status, claim.message = MeeshoReturnClaim.STATUS_QUEUED, "Waiting for the files to finish sending…"
                    save("status", "message")
                    return {"next": "wait", "in": FILES_WAIT}
                name, ctype = meta["name"], meta["content_type"]
                size = os.path.getsize(path)
                if ctype.startswith("video/") and size > MEESHO_VIDEO_MAX:
                    note("compressing", f"{name} {size / 1048576:.1f} MB")
                    data, name = compress_video(path, name)          # read from disk by ffmpeg, never loaded here
                    ctype = "video/mp4"
                else:
                    data = _read(path)                                # at most Meesho's cap
                item["url"] = upload(account, name, data, ctype)
                item["sent_size"] = len(data)
                save("files")
                note("file sent", f"{key}: {name} {len(data) / 1048576:.1f} MB")
                shutil.rmtree(_upload_dir(item["upload_id"]), ignore_errors=True)
        for key, items in (claim.files or {}).items():
            urls = [i["url"] for i in items if i.get("url")]
            if urls:
                prior = values.get(key) if isinstance(values.get(key), list) else []
                values[key] = prior + [u for u in urls if u not in prior]

        # 2. The return's proof of delivery, in Attachments.
        if claim.pod_url and not claim.pod_meesho_url and any(f["key"] == "attachments" for f in fields):
            pod = _fetch_pod(claim.pod_url)
            if pod:
                claim.pod_meesho_url = upload(account, pod[1], pod[0], pod[2])
                save("pod_meesho_url")
                note("pod attached", claim.pod_meesho_url)
            elif not any(e.get("step") == "pod skipped" for e in claim.events or []):
                note("pod skipped", "the POD link isn't a downloadable file")
        if claim.pod_meesho_url:
            att = values.get("attachments") if isinstance(values.get("attachments"), list) else []
            if claim.pod_meesho_url not in att:
                values["attachments"] = att + [claim.pod_meesho_url]

        # 3. The ticket.
        details = ticket_details(fields, values, claim.labels or {})
        claim.details = details
        save("details")
        answer = create_ticket(account, claim.sub_category_id, details, claim.email)
    except TicketRefused as e:
        retry = _passing(e) and attempt < MAX_ATTEMPTS
        claim.message, claim.error_code = str(e)[:1000], e.code
        claim.answer = e.details.get("meesho_answer") or claim.answer
        claim.status = MeeshoReturnClaim.STATUS_RETRYING if retry else MeeshoReturnClaim.STATUS_FAILED
        if not retry:
            claim.finished_at = timezone.now()
        claim.events = (claim.events or []) + [_event("retrying" if retry else "failed", str(e))]
        save("message", "error_code", "answer", "status", "finished_at", "events")
        if not retry:
            _tell_failed(claim)
            return {"next": "failed"}
        return {"next": "retry", "in": RETRY_IN[min(attempt - 1, len(RETRY_IN) - 1)]}

    ticket = _ticket_id(answer) or ""
    claim.status, claim.ticket, claim.answer, claim.finished_at = MeeshoReturnClaim.STATUS_OK, ticket[:100], _short(answer), timezone.now()
    claim.message = f"Claim raised on Meesho for {claim.business.name}{f' — ticket {ticket}' if ticket else ''}."
    claim.events = (claim.events or []) + [_event("raised", ticket)]
    save("status", "ticket", "answer", "finished_at", "message", "events")
    ret = claim.return_delivery
    if ret:
        ret.claim_status, ret.claim_raised_at = ReturnDelivery.CLAIM_RAISED, timezone.now()
        ret.claim_reference = (ticket or ret.claim_reference)[:150]
        if not ret.packet_id and claim.packet_id:
            ret.packet_id = claim.packet_id
        line = f"{timezone.localdate():%d %b}: {claim.sub_category or 'Claim'} raised from the portal" + (f" (ticket {ticket})" if ticket else "")
        ret.claim_notes = f"{ret.claim_notes}\n{line}".strip()
        ret.save(update_fields=["claim_status", "claim_raised_at", "claim_reference", "packet_id", "claim_notes", "updated_at"])
    return {"next": "done"}


def give_up(claim_id, why):
    """The worker couldn't run the claim at all, time after time."""
    claim = MeeshoReturnClaim.objects.select_related("business").filter(pk=claim_id).first()
    if not claim or claim.status in (MeeshoReturnClaim.STATUS_OK, MeeshoReturnClaim.STATUS_FAILED):
        return
    claim.status, claim.error_code, claim.finished_at = MeeshoReturnClaim.STATUS_FAILED, "worker", timezone.now()
    claim.message = f"The background worker couldn't raise it: {why}"[:1000]
    claim.events = (claim.events or []) + [_event("failed", why)]
    claim.save(update_fields=["status", "error_code", "finished_at", "message", "events"])
    _tell_failed(claim)


def _tell_failed(claim):
    """A claim that failed for good: said on Telegram / email, where set up."""
    from . import notify
    if not notify.channels():
        return
    try:
        notify.send(f"Return claim failed — {claim.business.name}",
                    f"Sub-order {claim.sub_order_no} ({claim.sub_category or 'claim'}): {claim.message}\n"
                    f"Open Raise Return Claim to fix it and press Retry.")
    except Exception:                                              # noqa: BLE001 — the claim already says why
        pass
