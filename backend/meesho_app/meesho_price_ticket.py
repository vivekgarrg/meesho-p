"""
Price changes sent straight to Meesho — the panel's Support → "change the
price of these catalogs" ticket, with the price sheet attached:

  1. upload the sheet (the panel's attachment upload; Meesho validates it
     against its product-catalog template and stores it), which answers with
     the stored file's link;
  2. create the ticket (createTicket) with that link, a description, the
     reason and a callback number.

Sent with the business's saved Meesho session, from Django (as Order linking
is), so the person sees Meesho's answer at once. Every attempt is kept as a run
(kind PRICE_TKT) with the ticket id, or why Meesho refused.

The sheet is the one the Download button gives (_new_msp_workbook) — the ids
looked up from that business's own synced inventory.
"""

import json

import requests
from django.utils import timezone

from .meesho_linking import MEESHO_BASE, USER_AGENT
from .models import MeeshoAccount, MeeshoSyncRun

UPLOAD_PATH = "/api/experience/support/api/v1/upload/supplier-support/input-attachment"
TICKET_PATH = "/api/experience/support/createTicket"
CATEGORY_ID, SUB_CATEGORY_ID = "2", "15"            # Support → catalog price change
FAQ = {"faq_classification_id": "3598ae3f-d2dc-4258-8978-de3c55f8659c", "faq_classification_flow_type": "consent",
       "supplier_selected_sub_category_id": 15, "supplier_selected_category_id": 2, "misc": {}}
# The panel's "Why do you want to increase price?" choices that are known.
REASONS = {"raw_material_cost_increase": "Increase in raw material costs temporarily"}
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
KIND = "PRICE_TKT"                                   # a run's kind holds 10 characters
TIMEOUT = 60


class TicketRefused(Exception):
    def __init__(self, message, code="meesho_error", **details):
        super().__init__(message)
        self.code, self.details = code, details


def _session(account):
    from . import meesho_sync
    if account.status != MeeshoAccount.STATUS_ACTIVE or not account.cookies_enc:
        raise TicketRefused(f"{account.business.name}'s Meesho account isn't connected — log in under Meesho → Settings.", "no_session")
    if not (account.supplier_id and account.supplier_identifier):
        raise TicketRefused(f"{account.business.name}: the supplier ID and code aren't known — set them under Meesho → Settings.", "no_session")
    try:
        cookies = json.loads(meesho_sync.decrypt(account.cookies_enc))
    except Exception as exc:                                       # noqa: BLE001
        raise TicketRefused(f"The saved Meesho session can't be read ({exc.__class__.__name__}) — log in again.", "no_session")
    headers = {
        "accept": "application/json, text/plain, */*", "client-package-version": "1.2.4", "client-type": "d-web",
        "identifier": account.supplier_identifier, "origin": MEESHO_BASE, "user-agent": USER_AGENT,
        "referer": f"{MEESHO_BASE}/panel/v3/new/experience/{account.supplier_identifier}/support/{CATEGORY_ID}/{SUB_CATEGORY_ID}/create",
        "cookie": "; ".join(f"{k}={v}" for k, v in cookies.items()),
    }
    if account.browser_id:
        headers["browser-id"] = account.browser_id
    return headers


def _answer(res, what):
    if res.status_code in (401, 403, 463):
        raise TicketRefused(f"{what}: the Meesho session has expired — log in again under Meesho → Settings.", "no_session",
                            meesho_http=res.status_code)
    try:
        body = res.json()
    except ValueError:
        body = None
    if res.status_code >= 400 or (isinstance(body, dict) and (body.get("success") is False or body.get("error")
                                                              or str(body.get("status", "")).lower() in ("failure", "failed", "error"))):
        raise TicketRefused(f"{what}: Meesho refused it — {_reason(body) or f'HTTP {res.status_code}'}", "meesho_refused",
                            meesho_http=res.status_code, meesho_answer=_short(body))
    return body


def _reason(body):
    """Meesho's explanation, wherever in the answer it sits (validation errors included)."""
    if not isinstance(body, dict):
        return ""
    for k in ("message", "error_message", "errorMessage", "error", "msg", "reason"):
        v = body.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()[:300]
        if isinstance(v, dict):
            inner = _reason(v)
            if inner:
                return inner
    for k in ("errors", "validation_errors", "data"):
        v = body.get(k)
        if isinstance(v, list) and v:
            return "; ".join(str(x.get("message") if isinstance(x, dict) else x) for x in v[:5])[:300]
        if isinstance(v, dict):
            inner = _reason(v)
            if inner:
                return inner
    return ""


def _short(body):
    """Meesho's answer, small enough to keep on the run."""
    if body is None:
        return None
    text = json.dumps(body, default=str)
    return body if len(text) <= 4000 else text[:4000]


def _find(obj, test, depth=0):
    """The first value anywhere in a JSON answer that passes `test`."""
    if depth > 6:
        return None
    if isinstance(obj, dict):
        for v in obj.values():
            hit = _find(v, test, depth + 1)
            if hit is not None:
                return hit
    elif isinstance(obj, list):
        for v in obj:
            hit = _find(v, test, depth + 1)
            if hit is not None:
                return hit
    elif test(obj):
        return obj
    return None


def _ticket_id(answer, depth=0):
    """The ticket number in Meesho's answer: the first field named …ticket… with a value."""
    if depth > 5:
        return None
    if isinstance(answer, dict):
        for k, v in answer.items():
            if "ticket" in str(k).lower() and isinstance(v, (str, int)) and not isinstance(v, bool) and str(v).strip():
                return str(v)
        answer = list(answer.values())
    if isinstance(answer, list):
        for v in answer:
            hit = _ticket_id(v, depth + 1)
            if hit:
                return hit
    return None


def upload(account, filename, data, headers=None):
    """Upload the sheet as the panel attaches it. Returns the stored file's link."""
    headers = headers or _session(account)
    try:
        res = requests.post(MEESHO_BASE + UPLOAD_PATH, headers=headers, timeout=TIMEOUT,
                            files={"file": (filename, data, XLSX)},
                            data={"is_validation_required": "true", "entity_id": str(account.supplier_id), "entity_type": "SUPPLIER",
                                  "reference_template_key": "product_catalog_template_btn", "sub_category_id": SUB_CATEGORY_ID,
                                  "validation_key": "input_attachment"})
    except requests.RequestException as exc:
        raise TicketRefused(f"Couldn't reach Meesho to upload the sheet ({exc.__class__.__name__}).", "meesho_unreachable")
    body = _answer(res, "Uploading the sheet")
    url = _find(body, lambda v: isinstance(v, str) and v.startswith("https://") and "storage.googleapis.com" in v)
    if not url:
        raise TicketRefused(f"Meesho took the sheet but sent back no file link — {_reason(body) or 'check it on the panel'}.",
                            "no_file_link", meesho_answer=_short(body))
    return url


def create_ticket(account, file_url, description, reason, callback_number, email, headers=None):
    headers = {**(headers or _session(account)), "content-type": "application/json;charset=UTF-8"}
    body = {
        "category_id": CATEGORY_ID, "sub_category_id": SUB_CATEGORY_ID,
        "supplier_id": str(account.supplier_id), "supplier_identifier": account.supplier_identifier, "supplier_email_id": email,
        "ticket_details": [
            {"key": "input_attachment", "type": "img_file", "label": "", "value": [file_url]},
            {"key": "ticket_desc", "type": "text_area", "label": "Description", "value": description},
            {"key": "price_increase_reason", "type": "drop_down", "label": "Why do you want to increase price?", "value": reason,
             "selectedLabel": REASONS.get(reason, reason)},
            {"key": "callback_number", "type": "text_box", "label": "Callback Number", "value": callback_number},
        ],
        "faq_classification_info": FAQ,
    }
    try:
        res = requests.post(MEESHO_BASE + TICKET_PATH, headers=headers, json=body, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise TicketRefused(f"The sheet is uploaded, but Meesho couldn't be reached to raise the ticket ({exc.__class__.__name__}).",
                            "meesho_unreachable", file_url=file_url)
    return _answer(res, "Raising the ticket")


def submit(account, filename, data, *, description, reason, callback_number, email, user=None, rows=0, what=""):
    """
    Upload the sheet, raise the ticket, keep a run. Returns the run (OK or
    FAILED, with the ticket id or Meesho's reason on it).
    """
    run = MeeshoSyncRun.objects.create(account=account, kind=KIND, trigger=MeeshoSyncRun.TRIGGER_MANUAL,
                                       status=MeeshoSyncRun.STATUS_RUNNING, records=rows, started_at=timezone.now(),
                                       message=f"Sending the price change{f' for {what}' if what else ''} to Meesho…",
                                       result={"file": filename, "what": what, "rows": rows,
                                               "by": getattr(user, "username", None)})
    try:
        headers = _session(account)
        file_url = upload(account, filename, data, headers)
        answer = create_ticket(account, file_url, description, reason, callback_number, email, headers)
        ticket = _ticket_id(answer)
        run.status, run.finished_at = MeeshoSyncRun.STATUS_OK, timezone.now()
        run.message = f"Price change for {what or filename} sent to Meesho — {rows} row{'' if rows == 1 else 's'}" \
                      f"{f', ticket {ticket}' if ticket else ''}."
        run.result = {**run.result, "file_url": file_url, "ticket": ticket, "answer": _short(answer)}
    except TicketRefused as e:
        run.status, run.finished_at, run.message = MeeshoSyncRun.STATUS_FAILED, timezone.now(), str(e)[:500]
        run.result = {**run.result, "code": e.code, **{k: v for k, v in e.details.items()}}
    run.save()
    return run


def run_json(r):
    res = r.result or {}
    return {"id": r.pk, "business_name": r.account.business.name, "status": r.status, "message": r.message,
            "at": r.finished_at or r.queued_at, "file": res.get("file"), "what": res.get("what"), "rows": res.get("rows"),
            "ticket": res.get("ticket"), "file_url": res.get("file_url"), "by": res.get("by")}
