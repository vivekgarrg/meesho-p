"""
Sending a file to the people who run the business — WhatsApp, Telegram and/or
email, whichever is set up in the server's .env:

  WhatsApp: the WhatsApp Business Cloud API (Meta). WHATSAPP_TOKEN (a permanent
            system-user token), WHATSAPP_PHONE_NUMBER_ID (the bot's number, from
            WhatsApp Manager → API setup), WHATSAPP_TO (who gets it: numbers
            with country code, e.g. 919812345678; several separated by commas),
            and WHATSAPP_TEMPLATE — an approved template with a DOCUMENT header
            and one body variable ({{1}}, the caption), since a message the
            business starts must be a template. WHATSAPP_TEMPLATE_LANG (default
            "en"). WHATSAPP_API_VERSION (default v21.0).
  Telegram: TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID (yours,
            or a group's; several separated by commas).
  Email:    LABELS_EMAIL_TO (one or more addresses, comma-separated) and the
            SMTP settings in settings.py (EMAIL_HOST, EMAIL_HOST_USER…).

Each channel is tried on its own: one failing doesn't stop the other.
"""

import json
import os
import uuid
from urllib.request import Request, urlopen

TELEGRAM_FILE_LIMIT = 50 * 1024 * 1024
WHATSAPP_FILE_LIMIT = 100 * 1024 * 1024
WHATSAPP_CAPTION = 900                    # a template variable holds up to 1,024 characters


def _list(name):
    return [x.strip() for x in os.environ.get(name, "").split(",") if x.strip()]


def channels():
    """The channels that are set up: subset of ["whatsapp", "telegram", "email"]."""
    out = []
    if all(os.environ.get(k, "").strip() for k in ("WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TEMPLATE")) \
            and _list("WHATSAPP_TO"):
        out.append("whatsapp")
    if os.environ.get("TELEGRAM_BOT_TOKEN", "").strip() and _list("TELEGRAM_CHAT_ID"):
        out.append("telegram")
    if _list("LABELS_EMAIL_TO"):
        out.append("email")
    return out


def send(subject, text, filename=None, data=None):
    """
    Send `text` (and the file, when given) on every channel set up.
    Returns {channel: "sent" | "error: …"}; {} when none is set up.
    """
    results = {}
    if "whatsapp" in channels():
        try:
            if data is None:
                results["whatsapp"] = "skipped: nothing to send (WhatsApp sends the labels PDF)"
            else:
                media = _whatsapp_upload(filename, data)
                failed = []
                for to in _list("WHATSAPP_TO"):
                    try:
                        _whatsapp_send(to, media, filename, f"{subject} — {text}".strip())
                    except Exception as exc:  # noqa: BLE001 — one number failing doesn't stop the rest
                        failed.append(f"{to}: {exc}")
                results["whatsapp"] = f"error: {'; '.join(failed)}" if failed else "sent"
        except Exception as exc:              # noqa: BLE001
            results["whatsapp"] = f"error: {exc}"
    if "telegram" in channels():
        try:
            for chat in _list("TELEGRAM_CHAT_ID"):
                _telegram(chat, f"{subject}\n\n{text}".strip(), filename, data)
            results["telegram"] = "sent"
        except Exception as exc:              # noqa: BLE001 — reported, never fatal
            results["telegram"] = f"error: {exc}"
    if "email" in channels():
        try:
            from django.core.mail import EmailMessage
            msg = EmailMessage(subject=subject, body=text, to=_list("LABELS_EMAIL_TO"))
            if data is not None:
                msg.attach(filename, data, "application/pdf")
            msg.send(fail_silently=False)
            results["email"] = "sent"
        except Exception as exc:              # noqa: BLE001
            results["email"] = f"error: {exc}"
    return results


def _telegram(chat_id, caption, filename, data):
    token = os.environ["TELEGRAM_BOT_TOKEN"].strip()
    if data is None:
        body = json.dumps({"chat_id": chat_id, "text": caption[:4000]}).encode()
        req = Request(f"https://api.telegram.org/bot{token}/sendMessage", data=body,
                      headers={"Content-Type": "application/json"})
    else:
        if len(data) > TELEGRAM_FILE_LIMIT:
            raise ValueError("the PDF is over Telegram's 50 MB limit")
        boundary = uuid.uuid4().hex
        parts = []
        for name, value in (("chat_id", str(chat_id)), ("caption", caption[:1000])):
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="document"; filename="{filename}"\r\n'
                     f"Content-Type: application/pdf\r\n\r\n".encode() + data + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        req = Request(f"https://api.telegram.org/bot{token}/sendDocument", data=b"".join(parts),
                      headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urlopen(req, timeout=120) as resp:
        answer = json.loads(resp.read() or b"{}")
    if not answer.get("ok"):
        raise ValueError(answer.get("description") or "Telegram refused it")


def _whatsapp_url(path):
    version = os.environ.get("WHATSAPP_API_VERSION", "v21.0").strip() or "v21.0"
    return f"https://graph.facebook.com/{version}/{os.environ['WHATSAPP_PHONE_NUMBER_ID'].strip()}/{path}"


def _whatsapp_call(req):
    from urllib.error import HTTPError
    req.add_header("Authorization", f"Bearer {os.environ['WHATSAPP_TOKEN'].strip()}")
    try:
        with urlopen(req, timeout=120) as resp:
            return json.loads(resp.read() or b"{}")
    except HTTPError as exc:
        try:
            err = json.loads(exc.read() or b"{}").get("error") or {}
        except ValueError:
            err = {}
        raise ValueError(err.get("error_user_msg") or err.get("message") or f"HTTP {exc.code}") from None


def _whatsapp_upload(filename, data):
    """Upload the PDF to WhatsApp once; returns its media id (used for every number)."""
    if len(data) > WHATSAPP_FILE_LIMIT:
        raise ValueError("the PDF is over WhatsApp's 100 MB limit")
    boundary = uuid.uuid4().hex
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
             for k, v in (("messaging_product", "whatsapp"), ("type", "application/pdf"))]
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                 f"Content-Type: application/pdf\r\n\r\n".encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    answer = _whatsapp_call(Request(_whatsapp_url("media"), data=b"".join(parts),
                                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}))
    if not answer.get("id"):
        raise ValueError("WhatsApp didn't take the PDF")
    return answer["id"]


def _whatsapp_send(to, media_id, filename, caption):
    """The labels template to one number: the PDF as its header, the caption as {{1}}."""
    caption = " ".join(caption.split())[:WHATSAPP_CAPTION]           # template variables can't hold new lines
    body = {
        "messaging_product": "whatsapp", "to": "".join(ch for ch in to if ch.isdigit()), "type": "template",
        "template": {
            "name": os.environ["WHATSAPP_TEMPLATE"].strip(),
            "language": {"code": os.environ.get("WHATSAPP_TEMPLATE_LANG", "en").strip() or "en"},
            "components": [
                {"type": "header", "parameters": [{"type": "document", "document": {"id": media_id, "filename": filename}}]},
                {"type": "body", "parameters": [{"type": "text", "text": caption or "Labels"}]},
            ],
        },
    }
    answer = _whatsapp_call(Request(_whatsapp_url("messages"), data=json.dumps(body).encode(),
                                    headers={"Content-Type": "application/json"}))
    if not answer.get("messages"):
        raise ValueError("WhatsApp didn't accept the message")
