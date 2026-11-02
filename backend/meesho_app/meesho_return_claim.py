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

import json

import requests
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
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
MAX_UPLOAD = 22 * 1024 * 1024                   # Meesho's cap on one attachment
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


def _views():
    from . import views
    return views


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
            "ticket": c.ticket, "message": c.message, "at": c.created_at,
            "by": c.created_by.username if c.created_by else None}


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
        # Flagged damaged / tampered on Return Scan — the claim starts from that.
        "damaged": bool(scan), "damage_note": scan.damage_note if scan else "",
    }


@api_view(["GET"])
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
        return Response({"error": f"{f.name} is {f.size / 1048576:.1f} MB — Meesho takes at most 22 MB. Compress it first."},
                        status=status.HTTP_400_BAD_REQUEST)
    try:
        url = upload(account, f.name, f.read(), f.content_type or "application/octet-stream")
    except TicketRefused as e:
        return _refused(e)
    return Response({"url": url, "name": f.name, "size": f.size})


@api_view(["GET", "POST"])
@parser_classes([JSONParser])
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
    email = str(d.get("email") or "").strip()
    if not sub:
        return Response({"error": "Choose what the claim is for."}, status=status.HTTP_400_BAD_REQUEST)
    if "@" not in email:
        return Response({"error": "An email for Meesho's reply is needed."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        fields = schema(account, sub) or KNOWN_FIELDS
    except TicketRefused as e:
        return _refused(e)
    missing = [f["label"] for f in fields if f["required"] and not values.get(f["key"])]
    if missing:
        return Response({"error": "Fill in: " + ", ".join(missing) + ".", "code": "missing", "missing": missing},
                        status=status.HTTP_400_BAD_REQUEST)
    sub_order = str(values.get("sub_order_number") or "").strip()
    ret = ReturnDelivery.objects.filter(pk=d.get("return_id"), business=account.business).first() if d.get("return_id") else None
    details = ticket_details(fields, values, d.get("labels") or {})
    claim = MeeshoReturnClaim.objects.create(
        business=account.business, return_delivery=ret, sub_order_no=sub_order[:100],
        awb_number=str(values.get("awb_number") or "")[:100], packet_id=str(values.get("barcode_id") or "")[:150],
        sub_category_id=sub[:20], sub_category=str(d.get("sub_category") or "")[:200],
        description=str(values.get("ticket_desc") or ""), details=details, created_by=request.user)
    try:
        answer = create_ticket(account, sub, details, email)
    except TicketRefused as e:
        claim.status, claim.message, claim.answer = MeeshoReturnClaim.STATUS_FAILED, str(e)[:1000], e.details.get("meesho_answer")
        claim.save(update_fields=["status", "message", "answer"])
        return Response({"error": str(e), "code": e.code, "claim": _claim_json(claim)}, status=status.HTTP_502_BAD_GATEWAY)
    ticket = _ticket_id(answer) or ""
    claim.status, claim.ticket, claim.answer = MeeshoReturnClaim.STATUS_OK, ticket[:100], _short(answer)
    claim.message = f"Claim raised on Meesho for {account.business.name}{f' — ticket {ticket}' if ticket else ''}."
    claim.save(update_fields=["status", "ticket", "answer", "message"])
    if ret:
        ret.claim_status, ret.claim_raised_at = ReturnDelivery.CLAIM_RAISED, timezone.now()
        ret.claim_reference = (ticket or ret.claim_reference)[:150]
        if not ret.packet_id and claim.packet_id:
            ret.packet_id = claim.packet_id
        note = f"{timezone.localdate():%d %b}: {claim.sub_category or 'Claim'} raised from the portal" + (f" (ticket {ticket})" if ticket else "")
        ret.claim_notes = f"{ret.claim_notes}\n{note}".strip()
        ret.save(update_fields=["claim_status", "claim_raised_at", "claim_reference", "packet_id", "claim_notes", "updated_at"])
    return Response({"claim": _claim_json(claim)}, status=status.HTTP_201_CREATED)
