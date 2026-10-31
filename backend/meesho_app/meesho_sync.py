"""
Meesho API sync — the Django half.

The work itself (logging in to the Meesho supplier panel, keeping the session,
pulling data every few minutes) runs in the Rails/Sidekiq worker under sync/.
This side is the page people use: save the account's login, see the session
and every run, press Refresh. It hands work to Sidekiq by pushing jobs straight
onto Sidekiq's Redis queue, in Sidekiq's own job format, so nothing else sits
in between.

Secrets are encrypted with AES-256-GCM under MEESHO_SYNC_KEY (32 bytes,
base64). Stored as "v1:" + base64(nonce · ciphertext · tag); the Rails side
(sync/app/lib/secret_box.rb) reads and writes the same format.
"""

import base64
import json
import os
import secrets
import time
from datetime import timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import MeeshoAccount, MeeshoSyncRun, MeeshoSyncSnapshot

QUEUE_MANUAL = "critical"     # Refresh / login — ahead of the scheduled pulls
LOGIN_JOB = "MeeshoLoginJob"
SYNC_JOB = "MeeshoSyncJob"


class SyncNotConfigured(Exception):
    pass


# ── secrets ───────────────────────────────────────────────────────────────────

def _key():
    raw = os.environ.get("MEESHO_SYNC_KEY", "").strip()
    if not raw:
        raise SyncNotConfigured("MEESHO_SYNC_KEY is not set on the server.")
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise SyncNotConfigured("MEESHO_SYNC_KEY must be 32 bytes, base64-encoded.")
    return key


def encrypt(text):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = secrets.token_bytes(12)
    sealed = AESGCM(_key()).encrypt(nonce, text.encode(), None)      # ciphertext · tag
    return "v1:" + base64.b64encode(nonce + sealed).decode()


def decrypt(blob):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not blob.startswith("v1:"):
        raise ValueError("unknown secret format")
    raw = base64.b64decode(blob[3:])
    return AESGCM(_key()).decrypt(raw[:12], raw[12:], None).decode()


# ── Sidekiq ───────────────────────────────────────────────────────────────────

def _redis():
    import redis
    return redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0"),
                                socket_connect_timeout=2, socket_timeout=2)


def enqueue(job_class, args, queue=QUEUE_MANUAL):
    """Push one job onto Sidekiq's queue — exactly what Sidekiq::Client.push writes."""
    now = time.time()
    job = {"class": job_class, "args": args, "queue": queue, "retry": 2,
           "jid": secrets.token_hex(12), "created_at": now, "enqueued_at": now}
    r = _redis()
    with r.pipeline() as p:
        p.sadd("queues", queue)
        p.lpush(f"queue:{queue}", json.dumps(job))
        p.execute()
    return job["jid"]


def _worker_alive():
    """Whether a Sidekiq process has reported in during the last minute."""
    try:
        r = _redis()
        for proc in r.smembers("processes"):
            beat = r.hget(proc, "beat")
            if beat and time.time() - float(beat) < 60:
                return True
        return False
    except Exception:
        return None          # Redis itself unreachable


def _queue_run(account, kind, trigger):
    """Queue a login or sync — unless the same thing is already queued or running."""
    recent = account.runs.filter(kind=kind, status__in=[MeeshoSyncRun.STATUS_QUEUED, MeeshoSyncRun.STATUS_RUNNING],
                                 queued_at__gte=timezone.now() - timedelta(minutes=3)).first()
    if recent:
        return recent, False
    run = MeeshoSyncRun.objects.create(account=account, kind=kind, trigger=trigger)
    job = LOGIN_JOB if kind == MeeshoSyncRun.KIND_LOGIN else SYNC_JOB
    try:
        enqueue(job, [account.pk, run.pk])
    except Exception as exc:
        run.status, run.message, run.finished_at = MeeshoSyncRun.STATUS_FAILED, f"Could not reach the job queue: {exc}", timezone.now()
        run.save(update_fields=["status", "message", "finished_at"])
        raise SyncNotConfigured("The job queue (Redis) isn't reachable — is Redis running on the server?") from exc
    return run, True


# ── API ───────────────────────────────────────────────────────────────────────

def _views():
    from . import views
    return views


def _mask(phone):
    return f"{'•' * max(0, len(phone) - 4)}{phone[-4:]}" if phone else ""


def _account_json(a):
    if not a:
        return None
    return {
        "phone": _mask(a.phone_number), "status": a.status, "status_message": a.status_message,
        "supplier_id": a.supplier_id, "supplier_name": a.supplier_name, "supplier_identifier": a.supplier_identifier,
        "has_session": bool(a.cookies_enc), "last_login_at": a.last_login_at,
        "sync_enabled": a.sync_enabled, "sync_interval_minutes": a.sync_interval_minutes,
        "last_sync_at": a.last_sync_at, "last_sync_status": a.last_sync_status, "last_sync_message": a.last_sync_message,
        "next_sync_at": (a.last_sync_at + timedelta(minutes=a.sync_interval_minutes)) if a.last_sync_at and a.sync_enabled else None,
        "advanced": {"device_id": a.device_id, "instance": a.instance, "browser_id": a.browser_id},
    }


PREVIEW_ROWS = 25
PREVIEW_COLUMNS = 10


def _flat(row, prefix="", out=None, depth=0):
    """A row's simple values as {"a.b": value}, a couple of levels deep."""
    out = {} if out is None else out
    if isinstance(row, dict) and depth < 2:
        for k, v in row.items():
            _flat(v, f"{prefix}{k}." if isinstance(v, dict) else f"{prefix}{k}", out, depth + 1)
    elif not isinstance(row, (dict, list)):
        out[prefix.rstrip(".")] = row
    return out


def _snapshot_json(s):
    """One endpoint's latest pull: when, how many rows, and the first few as a table."""
    rows = s.payload if isinstance(s.payload, list) else None
    preview, columns = [], []
    if rows:
        flat = [_flat(r) for r in rows[:PREVIEW_ROWS] if isinstance(r, dict)]
        for f in flat:
            for k in f:
                if k not in columns:
                    columns.append(k)
        columns = columns[:PREVIEW_COLUMNS]
        preview = [[f.get(c) for c in columns] for f in flat]
    return {"endpoint": s.endpoint, "http_status": s.http_status, "fetched_at": s.fetched_at,
            "rows": len(rows) if rows is not None else None, "columns": columns, "preview": preview}


STUCK_AFTER = timedelta(minutes=10)


def _run_json(r):
    """A run as the page shows it. One still queued or running after STUCK_AFTER
    never finished — the worker stopped or crashed — so it is shown as such
    instead of spinning forever."""
    status, message = r.status, r.message
    if status in (MeeshoSyncRun.STATUS_QUEUED, MeeshoSyncRun.STATUS_RUNNING) and r.queued_at < timezone.now() - STUCK_AFTER:
        status, message = "STUCK", "Didn't finish — the sync worker stopped or crashed. Check it's running, then Refresh."
    return {"id": r.id, "kind": r.kind, "trigger": r.trigger, "status": status, "message": message, "records": r.records,
            "queued_at": r.queued_at, "started_at": r.started_at, "finished_at": r.finished_at}


def _state(request, business):
    a = MeeshoAccount.objects.filter(business=business).first()
    try:
        _key()
        key_ok, key_msg = True, ""
    except SyncNotConfigured as exc:
        key_ok, key_msg = False, str(exc)
    alive = _worker_alive()
    return {
        "is_admin": _views()._is_admin(request.user),
        "account": _account_json(a),
        "runs": [_run_json(r) for r in (a.runs.all()[:25] if a else [])],
        # Sorted here, not in SQL: ORDER BY over rows carrying big JSON payloads
        # runs MySQL out of sort memory ("Out of sort memory", error 1038).
        "snapshots": [_snapshot_json(s) for s in sorted(a.snapshots.all() if a else [], key=lambda s: s.endpoint)],
        "setup": {"key": key_ok, "key_message": key_msg, "queue": alive is not None, "worker": bool(alive)},
    }


@api_view(["GET"])
def meesho_sync_status(request, business_id):
    """The account, its session, recent runs, what has been fetched, and whether the worker is up."""
    business = _views().get_authorized_business(request, business_id)
    return Response(_state(request, business))


@api_view(["POST"])
def meesho_sync_connect(request, business_id):
    """
    Admin: save (or replace) the Meesho login and queue a login right away.
    Body: {phone_number, password, device_id?, instance?, browser_id?}.
    The password is encrypted before it is stored and is never sent back.
    """
    v = _views()
    business = v.get_authorized_business(request, business_id)
    if not v._is_admin(request.user):
        return Response({"error": "Only an admin can connect a Meesho account."}, status=status.HTTP_403_FORBIDDEN)
    d = request.data if isinstance(request.data, dict) else {}
    phone = "".join(ch for ch in str(d.get("phone_number") or "") if ch.isdigit())
    password = str(d.get("password") or "")
    if len(phone) < 10 or not password:
        return Response({"error": "Enter the Meesho login phone number and password."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        password_enc = encrypt(password)
    except SyncNotConfigured as exc:
        return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    a, _ = MeeshoAccount.objects.update_or_create(business=business, defaults={
        "phone_number": phone, "password_enc": password_enc,
        "device_id": str(d.get("device_id") or "").strip()[:64],
        "instance": str(d.get("instance") or "").strip()[:128],
        "browser_id": str(d.get("browser_id") or "").strip()[:128],
        "supplier_identifier": str(d.get("supplier_identifier") or "").strip()[:64],
        "cookies_enc": "", "status": MeeshoAccount.STATUS_NEW, "status_message": "Logging in…",
        "sync_enabled": True, "created_by": request.user,
    })
    try:
        _queue_run(a, MeeshoSyncRun.KIND_LOGIN, MeeshoSyncRun.TRIGGER_MANUAL)
    except SyncNotConfigured as exc:
        return Response({**_state(request, business), "error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response(_state(request, business), status=status.HTTP_201_CREATED)


@api_view(["POST"])
def meesho_sync_refresh(request, business_id):
    """Pull everything now, ahead of the schedule (logs in first if the session has lapsed)."""
    business = _views().get_authorized_business(request, business_id)
    a = MeeshoAccount.objects.filter(business=business).exclude(status=MeeshoAccount.STATUS_DISABLED).first()
    if not a:
        return Response({"error": "Connect a Meesho account first."}, status=status.HTTP_400_BAD_REQUEST)
    try:
        _, queued = _queue_run(a, MeeshoSyncRun.KIND_SYNC, MeeshoSyncRun.TRIGGER_MANUAL)
    except SyncNotConfigured as exc:
        return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({**_state(request, business), "queued": queued})


@api_view(["PATCH"])
def meesho_sync_settings(request, business_id):
    """Admin: turn the schedule on/off and set how often it pulls (1–60 minutes)."""
    v = _views()
    business = v.get_authorized_business(request, business_id)
    if not v._is_admin(request.user):
        return Response({"error": "Only an admin can change the sync."}, status=status.HTTP_403_FORBIDDEN)
    a = MeeshoAccount.objects.filter(business=business).first()
    if not a:
        return Response({"error": "Connect a Meesho account first."}, status=status.HTTP_400_BAD_REQUEST)
    d = request.data if isinstance(request.data, dict) else {}
    if "sync_enabled" in d:
        a.sync_enabled = bool(d["sync_enabled"])
    if "sync_interval_minutes" in d:
        try:
            minutes = int(d["sync_interval_minutes"])
        except (TypeError, ValueError):
            minutes = 0
        if not 1 <= minutes <= 60:
            return Response({"error": "Pull every 1 to 60 minutes."}, status=status.HTTP_400_BAD_REQUEST)
        a.sync_interval_minutes = minutes
    if "supplier_identifier" in d:
        a.supplier_identifier = str(d["supplier_identifier"] or "").strip()[:64]
    if "supplier_id" in d:
        sid = "".join(ch for ch in str(d["supplier_id"] or "") if ch.isdigit())
        a.supplier_id = sid[:64]
    if "supplier_name" in d:
        a.supplier_name = str(d["supplier_name"] or "").strip()[:255]
    a.save()
    return Response(_state(request, business))


@api_view(["POST"])
def meesho_sync_disconnect(request, business_id):
    """Admin: stop syncing and wipe the stored password and session."""
    v = _views()
    business = v.get_authorized_business(request, business_id)
    if not v._is_admin(request.user):
        return Response({"error": "Only an admin can disconnect."}, status=status.HTTP_403_FORBIDDEN)
    MeeshoAccount.objects.filter(business=business).update(
        password_enc="", cookies_enc="", status=MeeshoAccount.STATUS_DISABLED, sync_enabled=False,
        status_message="Disconnected — the saved password and session were deleted.")
    return Response(_state(request, business))


# ── Meesho Orders dashboard ───────────────────────────────────────────────────
# Combines every business on this person's desk that has a Meesho account —
# the same businesses Order Scan combines (see views._scan_desk_scope). Each
# order carries its business; accepting and making labels go to each order's
# own Meesho account.

ORDER_TABS = [
    ("hold", "On hold"),
    ("pending", "Pending"),
    ("ready_to_ship", "Ready to ship"),
    ("cancelled", "Cancelled"),
]
DASHBOARD_ROWS = 2000
DESK_PATH = "meesho-orders/"

ACCEPT_JOB = "MeeshoAcceptJob"
KIND_ACCEPT = "ACCEPT"
ACCEPT_MAX = 500

LABEL_JOB = "MeeshoLabelJob"
KIND_LABELS = "LABELS"
LABELS_MAX = 500
# Meesho hands back a signed Google Cloud Storage link to the PDF. Only fetch
# from there (a link pointing anywhere else is refused).
LABEL_HOSTS = tuple(h.strip() for h in os.environ.get("MEESHO_LABEL_HOSTS", "storage.googleapis.com").split(",") if h.strip())


def _desk_accounts(request, business):
    """The businesses this desk combines, and the Meesho accounts among them."""
    desk = _views()._scan_desk_scope(request, business, api_path=DESK_PATH)
    accounts = list(MeeshoAccount.objects.filter(business__in=desk).select_related("business"))
    return desk, accounts


def _packet_ids(rows_by_business):
    """Packet IDs the Orders CSV recorded, per (business, sub-order) — Meesho's
    order tabs don't carry them."""
    from .models import Order
    out = {}
    for biz_id, subs in rows_by_business.items():
        subs = [s for s in subs if s]
        for i in range(0, len(subs), 500):
            for sub, pid in (Order.objects.filter(business_id=biz_id, sub_order_no__in=subs[i:i + 500])
                             .exclude(packet_id__isnull=True).exclude(packet_id__in=["", "nan", "None"])
                             .values_list("sub_order_no", "packet_id")):
                out[(biz_id, sub)] = pid
    return out


def _label_batches(accounts):
    """Label runs grouped by the request that made them (one per business)."""
    runs = MeeshoSyncRun.objects.filter(account__in=accounts, kind=KIND_LABELS).select_related("account__business")[:30]
    batches = {}
    for r in runs:
        key = (r.result or {}).get("batch") or f"run-{r.pk}"
        b = batches.setdefault(key, {"batch": key, "queued_at": r.queued_at, "runs": []})
        b["queued_at"] = max(b["queued_at"], r.queued_at)
        j = _run_json(r)
        b["runs"].append({**j, "business_name": r.account.business.name,
                          "ready": bool((r.result or {}).get("label_url")),
                          "success": (r.result or {}).get("success"), "total": (r.result or {}).get("total")})
    out = []
    for b in sorted(batches.values(), key=lambda b: b["queued_at"], reverse=True)[:5]:
        runs = b["runs"]
        b["busy"] = any(x["status"] in (MeeshoSyncRun.STATUS_QUEUED, MeeshoSyncRun.STATUS_RUNNING) for x in runs)
        b["ready"] = sum(1 for x in runs if x["ready"])
        b["success"] = sum(x["success"] or 0 for x in runs)
        b["total"] = sum(x["total"] or x["records"] or 0 for x in runs)
        b["orders"] = sum(x["records"] or 0 for x in runs)
        out.append(b)
    return out


@api_view(["GET"])
def meesho_orders_dashboard(request, business_id):
    """
    The Meesho panel's order tabs as last pulled by the sync, across every
    business this desk combines: how many orders sit in each tab, which are
    close to or past their dispatch SLA, and the orders themselves (each with
    its business, AWB and — when the Orders CSV has it — packet ID).
    """
    business = _views().get_authorized_business(request, business_id)
    desk, accounts = _desk_accounts(request, business)
    snaps = {}
    for s in MeeshoSyncSnapshot.objects.filter(account__in=accounts, endpoint__startswith="orders_").select_related("account__business"):
        snaps.setdefault(s.endpoint, []).append(s)
    today = timezone.localdate().isoformat()

    tab_rows = {}
    subs_by_biz = {}
    for key, _label in ORDER_TABS:
        rows = []
        for s in snaps.get(f"orders_{key}", []):
            biz = s.account.business
            for r in (s.payload if isinstance(s.payload, list) else []):
                rows.append({**r, "business_id": biz.pk, "business_name": biz.name})
                subs_by_biz.setdefault(biz.pk, set()).add(r.get("sub_order_num"))
        tab_rows[key] = rows
    packets = _packet_ids(subs_by_biz)

    tabs = []
    for key, label in ORDER_TABS:
        rows = tab_rows[key]
        for r in rows:
            r["packet_id"] = packets.get((r["business_id"], r.get("sub_order_num")))
        fetched = [s.fetched_at for s in snaps.get(f"orders_{key}", [])]
        sla = {}
        for r in rows:
            sla[r.get("sla_status") or "none"] = sla.get(r.get("sla_status") or "none", 0) + 1
        ordered = (sorted(rows, key=lambda r: r.get("created_iso") or "", reverse=True) if key == "cancelled"
                   else sorted(rows, key=lambda r: (r.get("dispatch_by") or "9999", r.get("created_iso") or "")))
        tabs.append({
            "key": key, "label": label, "count": len(rows), "fetched_at": min(fetched) if fetched else None,
            "breached": sum(v for k, v in sla.items() if "breach" in k and "soon" not in k),
            "breaching_soon": sla.get("breaching_soon", 0),
            "due_today": sum(1 for r in rows if r.get("dispatch_by") == today),
            "label_pending": sum(1 for r in rows if r.get("label") in (False, "Not Downloaded")),
            "rows": ordered[:DASHBOARD_ROWS],
        })

    alive = _worker_alive()
    live = [a for a in accounts if a.status != MeeshoAccount.STATUS_DISABLED]
    acc_json = []
    for a in accounts:
        j = _account_json(a)
        acc_json.append({**j, "business_id": a.business_id, "business_name": a.business.name})
    accepts = []
    for r in MeeshoSyncRun.objects.filter(account__in=accounts, kind=KIND_ACCEPT).select_related("account__business")[:10]:
        accepts.append({**_run_json(r), "business_name": r.account.business.name})
    return Response({
        "is_admin": _views()._is_admin(request.user),
        "connected": bool(live),
        "accounts": acc_json,
        # The business on screen's own account (Sync settings, older clients).
        "account": next((j for j in acc_json if j["business_id"] == business.pk), acc_json[0] if acc_json else None),
        "businesses": [{"id": b.pk, "name": b.name, "connected": any(a.business_id == b.pk for a in live)} for b in desk],
        "worker": bool(alive), "queue": alive is not None,
        "syncing": MeeshoSyncRun.objects.filter(account__in=live, status__in=[MeeshoSyncRun.STATUS_QUEUED, MeeshoSyncRun.STATUS_RUNNING],
                                                queued_at__gte=timezone.now() - STUCK_AFTER).exists(),
        "tabs": tabs,
        "today": today,
        "accepts": accepts,
        "label_batches": _label_batches(accounts),
    })


@api_view(["POST"])
def meesho_orders_refresh(request, business_id):
    """Pull every combined business's Meesho tabs now."""
    business = _views().get_authorized_business(request, business_id)
    _desk, accounts = _desk_accounts(request, business)
    live = [a for a in accounts if a.status != MeeshoAccount.STATUS_DISABLED]
    if not live:
        return Response({"error": "Connect a Meesho account first."}, status=status.HTTP_400_BAD_REQUEST)
    queued = 0
    try:
        for a in live:
            _, q = _queue_run(a, MeeshoSyncRun.KIND_SYNC, MeeshoSyncRun.TRIGGER_MANUAL)
            queued += int(q)
    except SyncNotConfigured as exc:
        return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({"queued": queued, "accounts": len(live)})


def _chosen_orders(request, business, accounts, tab_endpoint, kind, max_orders, busy_message, tab_label):
    """
    Validate a selection of orders across businesses and group it by Meesho
    account. Body: {"orders": [{"business_id": 2, "sub_order_num": "…_1"}, …]}
    (or {"sub_order_nums": [...]} for the business on screen). Returns
    ({account: [groups…]}, None) or (None, Response-with-the-error). Nothing is
    sent unless every business's part checks out.
    """
    data = request.data if isinstance(request.data, dict) else {}
    picked = data.get("orders")
    if not isinstance(picked, list):
        picked = [{"business_id": business.pk, "sub_order_num": s} for s in (data.get("sub_order_nums") or [])]
    by_biz = {}
    for o in picked:
        try:
            biz = int(o.get("business_id"))
        except (TypeError, ValueError, AttributeError):
            continue
        sub = str(o.get("sub_order_num") or "").strip()
        if sub:
            by_biz.setdefault(biz, [])
            if sub not in by_biz[biz]:
                by_biz[biz].append(sub)
    total = sum(len(v) for v in by_biz.values())
    if not total:
        return None, Response({"error": "Choose the orders first."}, status=status.HTTP_400_BAD_REQUEST)
    if total > max_orders:
        return None, Response({"error": f"At most {max_orders} orders at a time."}, status=status.HTTP_400_BAD_REQUEST)

    by_account = {a.business_id: a for a in accounts if a.status == MeeshoAccount.STATUS_ACTIVE}
    plan = {}
    for biz, subs in by_biz.items():
        a = by_account.get(biz)
        if not a:
            return None, Response({"error": "One of these businesses has no connected Meesho account."},
                                  status=status.HTTP_400_BAD_REQUEST)
        name = a.business.name
        if not (a.supplier_id and a.supplier_identifier):
            return None, Response({"error": f"{name}: set the supplier ID and code on Meesho Sync first."},
                                  status=status.HTTP_400_BAD_REQUEST)
        if a.runs.filter(kind=kind, status__in=[MeeshoSyncRun.STATUS_QUEUED, MeeshoSyncRun.STATUS_RUNNING],
                         queued_at__gte=timezone.now() - STUCK_AFTER).exists():
            return None, Response({"error": f"{name}: {busy_message}"}, status=status.HTTP_409_CONFLICT)
        snap = a.snapshots.filter(endpoint=tab_endpoint).first()
        have = {r.get("sub_order_num"): r for r in (snap.payload if snap and isinstance(snap.payload, list) else [])}
        missing = [s for s in subs if s not in have]
        if missing:
            return None, Response({"error": f"{name}: {len(missing)} of these are no longer in {tab_label} "
                                            f"({', '.join(missing[:3])}{'…' if len(missing) > 3 else ''}). Refresh and choose again."},
                                  status=status.HTTP_409_CONFLICT)
        rows = [have[s] for s in subs]
        if any(not (r.get("sub_order_id") and r.get("grouping_key")) for r in rows):
            return None, Response({"error": f"{name}: these were pulled before this was supported — press Refresh, then try again."},
                                  status=status.HTTP_409_CONFLICT)
        groups = {}
        for r in rows:
            g = groups.setdefault(r["grouping_key"], {"grouping_key": r["grouping_key"], "sub_order_ids": [],
                                                       "shipment_type": r.get("shipment_type") or "forward"})
            g["sub_order_ids"].append(r["sub_order_id"])
        plan[a] = (list(groups.values()), len(rows))
    return plan, None


def _send(plan, kind, job, message, result=None):
    """Create one run per account and queue its job. Returns the runs."""
    runs = []
    for a, (groups, n) in plan.items():
        run = MeeshoSyncRun.objects.create(account=a, kind=kind, trigger=MeeshoSyncRun.TRIGGER_MANUAL, records=n,
                                           message=message(n), result=result)
        try:
            enqueue(job, [a.pk, run.pk, groups])
        except Exception as exc:
            run.status, run.message, run.finished_at = MeeshoSyncRun.STATUS_FAILED, f"Could not reach the job queue: {exc}", timezone.now()
            run.save(update_fields=["status", "message", "finished_at"])
            raise SyncNotConfigured("The job queue (Redis) isn't reachable — nothing was sent to Meesho.") from exc
        runs.append(run)
    return runs


@api_view(["POST"])
def meesho_orders_accept(request, business_id):
    """
    Admin: accept pending orders on the Meesho panel — they move to Ready to
    ship. The selection may span businesses: each business's orders go to its
    own Meesho account in its own request (MeeshoAcceptJob).
    """
    v = _views()
    business = v.get_authorized_business(request, business_id)
    if not v._is_admin(request.user):
        return Response({"error": "Only an admin can accept orders on Meesho."}, status=status.HTTP_403_FORBIDDEN)
    _desk, accounts = _desk_accounts(request, business)
    plan, err = _chosen_orders(request, business, accounts, "orders_pending", KIND_ACCEPT, ACCEPT_MAX,
                               "an accept is already in progress — wait for it to finish.", "Pending")
    if err:
        return err
    try:
        runs = _send(plan, KIND_ACCEPT, ACCEPT_JOB, lambda n: f"Accepting {n} order{'' if n == 1 else 's'}…")
    except SyncNotConfigured as exc:
        return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({"runs": [_run_json(r) for r in runs], "run": _run_json(runs[0])}, status=status.HTTP_202_ACCEPTED)


@api_view(["POST"])
def meesho_orders_labels(request, business_id):
    """
    Admin: have Meesho generate shipping labels for chosen Ready-to-ship orders.
    The selection may span businesses: each business's labels are made on its
    own Meesho account (MeeshoLabelJob); the runs share a batch id, and
    meesho_orders_labels_batch_pdf merges and sorts them into one PDF.
    """
    import uuid
    v = _views()
    business = v.get_authorized_business(request, business_id)
    if not v._is_admin(request.user):
        return Response({"error": "Only an admin can generate labels on Meesho."}, status=status.HTTP_403_FORBIDDEN)
    _desk, accounts = _desk_accounts(request, business)
    plan, err = _chosen_orders(request, business, accounts, "orders_ready_to_ship", KIND_LABELS, LABELS_MAX,
                               "labels are already being generated — wait for them to finish.", "Ready to ship")
    if err:
        return err
    batch = uuid.uuid4().hex[:16]
    try:
        runs = _send(plan, KIND_LABELS, LABEL_JOB, lambda n: f"Generating {n} label{'' if n == 1 else 's'}…", {"batch": batch})
    except SyncNotConfigured as exc:
        return Response({"error": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({"batch": batch, "runs": [_run_json(r) for r in runs], "run": _run_json(runs[0])},
                    status=status.HTTP_202_ACCEPTED)


def _fetch_label_pdf(url):
    from urllib.parse import urlparse
    from urllib.request import Request, urlopen
    u = urlparse(url)
    if u.scheme not in ("https", "http") or (u.hostname or "") not in LABEL_HOSTS:
        raise ValueError("That label link isn't from Meesho's storage.")
    with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as resp:
        data = resp.read(60 * 1024 * 1024)
    if not data.startswith(b"%PDF"):
        raise ValueError("Meesho's link didn't return a PDF — it may have expired; generate the labels again.")
    return data


def _merge_pdfs(blobs):
    """One PDF holding every page of `blobs`, in order."""
    import io
    from pypdf import PdfReader, PdfWriter
    if len(blobs) == 1:
        return blobs[0]
    writer = PdfWriter()
    for data in blobs:
        for page in PdfReader(io.BytesIO(data)).pages:
            writer.add_page(page)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _sorted_labels_response(request, business, runs, file_name):
    """Download each run's labels, merge them, and sort the lot by parent SKU
    exactly as the Labels tab sorts an upload (also saving them to the labels
    table, as an upload does — so Order Scan has them)."""
    try:
        pdf = _merge_pdfs([_fetch_label_pdf(r.result["label_url"]) for r in runs])
    except Exception as exc:
        return Response({"error": f"Couldn't download the labels from Meesho: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)
    # Stamped with the noon-to-noon packing day, as the Labels tab uploads are.
    response = _views()._process_labels_upload(request, business, pdf, _views()._current_business_date().isoformat(),
                                                crop_labels=False, platform="meesho")
    if response.status_code == 200:
        response.data["sorted_pdf_b64"] = response.data.pop("cropped_pdf_b64", None)
        response.data["file_name"] = file_name
        response.data["businesses"] = sorted({r.account.business.name for r in runs})
    return response


@api_view(["POST"])
def meesho_orders_labels_batch_pdf(request, business_id, batch):
    """Every business's labels from one Generate — merged into one PDF, sorted by parent SKU."""
    business = _views().get_authorized_business(request, business_id)
    _desk, accounts = _desk_accounts(request, business)
    runs = [r for r in MeeshoSyncRun.objects.filter(account__in=accounts, kind=KIND_LABELS, result__batch=batch)
            .select_related("account__business") if (r.result or {}).get("label_url")]
    if not runs:
        return Response({"error": "Those labels aren't ready."}, status=status.HTTP_404_NOT_FOUND)
    first = min(r.queued_at for r in runs)
    return _sorted_labels_response(request, business, runs, f"meesho-labels-{timezone.localtime(first):%Y-%m-%d-%H%M}.pdf")


@api_view(["POST"])
def meesho_orders_labels_pdf(request, business_id, run_id):
    """One label run's PDF, sorted by parent SKU (see meesho_orders_labels_batch_pdf)."""
    business = _views().get_authorized_business(request, business_id)
    _desk, accounts = _desk_accounts(request, business)
    run = MeeshoSyncRun.objects.filter(pk=run_id, kind=KIND_LABELS, account__in=accounts).select_related("account__business").first()
    if not run or not (run.result or {}).get("label_url"):
        return Response({"error": "Those labels aren't ready."}, status=status.HTTP_404_NOT_FOUND)
    return _sorted_labels_response(request, business, [run], f"meesho-labels-{timezone.localtime(run.queued_at):%Y-%m-%d-%H%M}.pdf")
