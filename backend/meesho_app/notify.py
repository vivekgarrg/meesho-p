"""
Sending a file to the people who run the business — Telegram and/or email,
whichever is set up in the server's .env:

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


def _list(name):
    return [x.strip() for x in os.environ.get(name, "").split(",") if x.strip()]


def channels():
    """The channels that are set up: subset of ["telegram", "email"]."""
    out = []
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
