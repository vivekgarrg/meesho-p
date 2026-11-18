"""
Flipkart's automation, as Seller Hub's Forward Orders page does it (the requests
copied from the page: flipkart-api.py, never committed):

  accept   every `accept_every` minutes: AcceptOrders on every group waiting
           (flipkart_actions.act — groups without package dimensions are left
           for Seller Hub, said so).
  labels   at each label time: accept first, then every label waiting
           (pendingLabel) is printed in one PDF — Seller Hub's own Print
           (/napi/my-orders/revamped-orders-print) — kept as a MeeshoLabelFile
           (platform "flipkart") so it can be printed again from Labels
           Downloaded, sent to Telegram, and only then those groups are marked
           Ready to Dispatch (MarkRTD). Nothing is marked RTD whose labels
           weren't kept.

The settings are FlipkartAutoSetting (Business Settings → Flipkart setup). The
sync's schedule runs `manage.py flipkart_auto --run due` every minute; what is
due is claimed in the database first, so two runs never do the same slot twice.
A run "limited" to n shipments (the one-order test) accepts, prints and marks
RTD only groups of at most n shipments.
"""

import io
import time
from datetime import timedelta
from types import SimpleNamespace

from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import flipkart_actions as fa
from . import flipkart_seller as fs

PRINT_PATH = "/napi/my-orders/revamped-orders-print"
PRINT_CHUNK = 50                 # groups in one print request
PRINT_TRIES = 7                  # Seller Hub answers 500 while it still makes the documents: try again,
PRINT_RETRY_WAIT = 45            # this many seconds apart (about 5 minutes in all)
SINGLE_TRIES = 2                 # then group by group — the batch has waited already,
SINGLE_RETRY_WAIT = 5            # so a quick second try each (50 groups stay well inside the job's 15 minutes)
LABEL_WAIT_STEP = 15             # seconds between looks for the labels of what was just accepted,
LABEL_WAIT_MAX = 180             # and how long to keep looking: Seller Hub takes a while to make them
LABEL_SLOT_GRACE = timedelta(hours=2)    # a label time missed by more than this (the worker was down) isn't caught up
LOCK_TTL = 15 * 60


class AutoError(Exception):
    pass


# ── Seller Hub: print ────────────────────────────────────────────────────────

def _print_body(account, chunk, dbd):
    """Print's body, as the page sends it — a breached bucket's with is_breached; a dated one's groups with their date."""
    body = {
        "timestamp": fa._now(), "status": fa.STAGES["label"], "view": "group_shipment", "shipment_ids": [],
        "groups": [{"group_id": g["groupId"], "sub_group_index": g.get("subGroupIndex") or 0,
                    "shipment_count": g.get("shipmentCount") or 0,
                    "price_range": {"min_price": (g.get("priceRange") or {}).get("minPrice"),
                                    "max_price": (g.get("priceRange") or {}).get("maxPrice")},
                    "channel_of_sale": g.get("channelOfSale") or "FLIPKART",
                    "packaging_policy": g.get("packagingPolicy") or "DEFAULT", **fa._dated(dbd)} for g in chunk],
        "location_id": account.location_id, "seller_id": account.seller_id, "printer_setting": {},
    }
    if dbd is fa.BREACHED:
        body["is_breached"] = True
    return body


class PrintRefused(Exception):
    """Seller Hub answered, but not with the labels (e.g. HTTP 500 "All batches failed during document generation")."""


def _print_once(account, s, groups_, dbd, reprint):
    import requests
    jar = {c.name: c.value for c in s.cookies}
    headers = {"Accept": "application/pdf", "Content-Type": "application/json", "FK-CSRF-TOKEN": jar.get(fs.CSRF_COOKIE, ""),
               "Referer": f"{fs.BASE}/index.html", "Origin": fs.BASE}
    try:
        r = s.post(f"{fs.BASE}{PRINT_PATH}?reprint={'true' if reprint else 'false'}", json=_print_body(account, groups_, dbd),
                   headers=headers, timeout=90, allow_redirects=False)
    except requests.RequestException as e:
        raise PrintRefused(f"couldn't reach Flipkart ({e.__class__.__name__})")
    if r.status_code in (301, 302, 401) or "login" in (r.headers.get("location") or "").lower():
        raise fs.FlipkartError("Flipkart ended the session — log in again with a new OTP.", expired=True)
    if r.status_code >= 400 or not (r.content or b"").startswith(b"%PDF"):
        raise PrintRefused(f"HTTP {r.status_code}: {fs._message(r)}")
    return r.content


def _print_retrying(account, s, groups_, dbd, reprint, tries=None, wait=None):
    """Print, and when Seller Hub isn't ready (it answers 500 "All batches failed during document generation"
    while it still makes the documents of orders just accepted) wait and try again — PRINT_TRIES times."""
    last = None
    for attempt in range(tries or PRINT_TRIES):
        if attempt:
            time.sleep(PRINT_RETRY_WAIT if wait is None else wait)
        try:
            return _print_once(account, s, groups_, dbd, reprint), None
        except PrintRefused as e:
            last = str(e)
    return None, last


def print_labels(account, s, chosen, reprint=False):
    """
    The labels of these groups ([(bucket, group)]), as Seller Hub's Print sends them — retried while Seller Hub
    is still making the documents; a batch that keeps failing is printed group by group, so one group Seller
    Hub can't do never holds the others back. Returns (one PDF or None, [(bucket, group) printed], [(group, why)]).
    """
    from . import meesho_sync
    pdfs, printed, failed = [], [], []
    by_bucket = {}
    for dbd, g in chosen:
        by_bucket.setdefault(dbd, []).append(g)
    for dbd, part in by_bucket.items():
        for i in range(0, len(part), PRINT_CHUNK):
            chunk = part[i:i + PRINT_CHUNK]
            pdf, why = _print_retrying(account, s, chunk, dbd, reprint)
            if pdf:
                pdfs.append(pdf)
                printed += [(dbd, g) for g in chunk]
                continue
            if len(chunk) == 1:
                failed.append((chunk[0], why))
                continue
            for g in chunk:                            # one by one: which group is it?
                one, why_one = _print_retrying(account, s, [g], dbd, reprint, tries=SINGLE_TRIES, wait=SINGLE_RETRY_WAIT)
                if one:
                    pdfs.append(one)
                    printed.append((dbd, g))
                else:
                    failed.append((g, why_one))
    if not pdfs:
        return None, [], failed
    return (pdfs[0] if len(pdfs) == 1 else meesho_sync._merge_pdfs(pdfs)), printed, failed


# ── A run ────────────────────────────────────────────────────────────────────

def _small(groups_, limit):
    """Groups adding up to at most `limit` shipments, smallest first."""
    out, n = [], 0
    for item in sorted(groups_, key=lambda x: x[1].get("shipmentCount") or 0):
        size = item[1].get("shipmentCount") or 0
        if size and n + size <= limit:
            out.append(item)
            n += size
    return out


def _waiting(account, s, stage):
    return fa.waiting_groups(account, s, stage)


def _wait_for_labels(account, s, accepted, wait_max):
    """After accepting: look again every few seconds until every group just accepted has its label to print
    (Seller Hub takes a while to make them), up to `wait_max` seconds. Returns what's waiting to print then."""
    waited = 0
    while True:
        waiting = _waiting(account, s, "label")
        have = {g["groupId"] for _d, g in waiting}
        if not accepted or set(accepted) <= have or waited >= wait_max:
            return waiting, waited
        time.sleep(LABEL_WAIT_STEP)
        waited += LABEL_WAIT_STEP


def accept(account, s=None, limit=None):
    """Accept what's waiting (or, with `limit`, groups of at most that many shipments). Returns flipkart_actions.act's answer."""
    fa._need_location(account)
    s = s or fs._load(account, fs._http())
    if not limit:
        return fa.act(account, "accept", s=s)
    picked = _small([x for x in _waiting(account, s, "accept") if not x[1].get("missingDimensions")], limit)
    if not picked:
        return {"stage": "accept", "results": [], "skipped": [], "shipments": 0, "failed": 0, "errors": [], "groups": []}
    out = fa.act(account, "accept", wanted=[g["groupId"] for _d, g in picked], s=s)
    return {**out, "groups": [g["groupId"] for _d, g in picked]}


def _keep(account, pdf, trigger, shipments, summary):
    """Sort and crop it as the Labels tab does (saving the labels, so Order Scan's Flipkart desk has them), and keep it."""
    from accounts.models import User
    from . import meesho_sync, views
    from .models import MeeshoLabelFile
    kept, pages, note, order_ids = pdf, 0, "", []
    admin = User.objects.filter(role=User.ROLE_SUPER_ADMIN, is_active=True).order_by("pk").first()
    if admin:
        try:
            import base64
            res = views._process_labels_upload(SimpleNamespace(user=admin), account.business, pdf,
                                               views._current_business_date().isoformat(), crop_labels=False, platform="flipkart")
            if res.status_code == 200 and res.data.get("cropped_pdf_b64"):
                kept = base64.b64decode(res.data["cropped_pdf_b64"])
                pages = res.data.get("total_pages") or 0
                order_ids = meesho_sync.label_order_ids(res.data)
            else:
                note = "Not sorted — the labels couldn't be read."
        except Exception as exc:                       # noqa: BLE001 — the PDF is kept as Flipkart sent it
            note = f"Not sorted — {exc}."
    if not pages:
        try:
            from pypdf import PdfReader
            pages = len(PdfReader(io.BytesIO(kept)).pages)
        except Exception:                              # noqa: BLE001
            pages = 0
    f = MeeshoLabelFile.objects.create(
        batch=f"fk-{account.business_id}-{timezone.now():%Y%m%d%H%M%S%f}", trigger=trigger, platform="flipkart",
        business_ids=[account.business_id], business_names=[account.business.name], labels=shipments, pages=pages,
        sorted=not note, summary="\n".join(x for x in (note, summary) if x), order_ids=order_ids, pdf=kept)
    stale = list(MeeshoLabelFile.objects.filter(platform="flipkart").order_by("-created_at")
                 .values_list("pk", flat=True)[MeeshoLabelFile.KEEP:])
    if stale:
        MeeshoLabelFile.objects.filter(pk__in=stale).delete()
    return f


def labels(account, trigger="AUTO", send=True, rtd=True, limit=None, accept_first=True, wait=None):
    """
    Accept (first), print every label waiting, keep the PDF, send it, mark those groups RTD.
    `limit`: only groups of at most that many shipments, the ones just accepted first (the one-order test).
    Returns what happened, step by step.
    """
    from . import notify
    fa._need_location(account)
    s = fs._load(account, fs._http())
    out = {"business": account.business.name, "accepted": 0, "printed": 0, "rtd": 0, "file_id": None, "steps": []}
    just = []
    if accept_first:
        a = accept(account, s=s, limit=limit)
        out["accepted"] = a["shipments"]
        just = a.get("groups") or []
        out["steps"].append(f"Accepted {a['shipments']}" + (f" ({a['failed']} refused)" if a["failed"] else "")
                            + (f", {len(a['skipped'])} group(s) need package sizes in Seller Hub" if a.get("skipped") else ""))
    if just or out["accepted"]:
        accepted_ids = just or [gid for res in a["results"] for gid in res.get("group_ids", [])]
        waiting, waited = _wait_for_labels(account, s, accepted_ids, LABEL_WAIT_MAX if wait is None else wait)
        if waited:
            out["steps"].append(f"Waited {waited}s for Seller Hub to make the labels")
        missing = set(accepted_ids) - {g["groupId"] for _d, g in waiting}
        if missing:
            out["steps"].append(f"{len(missing)} accepted group(s) had no label yet — the next run prints them")
    else:
        waiting = _waiting(account, s, "label")
    if limit:
        mine = [x for x in waiting if x[1]["groupId"] in just]
        waiting = _small(mine or waiting, limit)
    shipments = sum(g.get("shipmentCount") or 0 for _d, g in waiting)
    when = timezone.localtime().strftime("%-I:%M %p, %-d %b")
    if not waiting:
        # Say what Seller Hub showed, so "nothing printed" can be understood from the card.
        try:
            printed = sum(n for _d, n in fa.buckets(account, s, "rtd"))
        except fs.FlipkartError:
            printed = None
        out["steps"].append("No labels waiting to print in Seller Hub (To pack → labels not printed is empty)"
                            + (f"; {printed} order(s) there already have their label printed — printed in Seller Hub, "
                               "they're not kept here" if printed else ""))
        return out
    pdf, waiting, failed = print_labels(account, s, waiting)
    not_printed = sum(g.get("shipmentCount") or 0 for g, _w in failed)
    if not pdf:
        why = failed[0][1] if failed else "no answer"
        raise fs.FlipkartError(f"Flipkart didn't make the labels of {not_printed} order(s) after {PRINT_TRIES} tries over "
                               f"{PRINT_TRIES * PRINT_RETRY_WAIT // 60} minutes ({why}) — nothing marked RTD; the next run tries again.")
    shipments = sum(g.get("shipmentCount") or 0 for _d, g in waiting)
    out["printed"] = shipments
    out["steps"].append(f"Printed {shipments} label{'' if shipments == 1 else 's'}")
    if failed:
        out["not_printed"] = [{"group_id": g["groupId"], "orders": g.get("shipmentCount") or 0, "why": w} for g, w in failed]
        out["steps"].append(f"{not_printed} order(s) Flipkart couldn't make labels for ({failed[0][1]}) — left, not marked RTD; "
                            "the next run tries again")
    f = _keep(account, pdf, trigger, shipments, " · ".join(out["steps"]))
    out["file_id"] = f.pk
    if send:
        caption = (f"{shipments} Flipkart label{'' if shipments == 1 else 's'} — {account.business.name}"
                   f"{', sorted by parent SKU' if f.sorted else ''}."
                   + (f"\n⚠ {not_printed} order(s) Flipkart couldn't make labels for yet — the next run tries again." if failed else ""))
        out["sent"] = notify.send(f"Flipkart labels — {when}", caption,
                                  filename=f"flipkart-labels-{timezone.localtime():%Y-%m-%d-%H%M}.pdf", data=bytes(f.pdf))
        # Then what's on them — the pick list, as Meesho's: the desk sees the items without opening the PDF.
        try:
            from . import meesho_sync
            picks = meesho_sync.pick_list_text(f)
            if picks:
                out["pick_list_sent"] = notify.send(f"Flipkart labels — {when} — items", picks)
        except Exception as exc:                       # noqa: BLE001 — the PDF itself went out
            out["pick_list_error"] = str(exc)[:200]
    if rtd:
        r = fa.act(account, "rtd", wanted=[g["groupId"] for _d, g in waiting], s=s)
        out["rtd"] = r["shipments"] - r["failed"]
        out["rtd_errors"] = r["errors"] + [x["error"] for res in r["results"] for x in res["failed"]][:5]
        out["steps"].append(f"Marked {out['rtd']} Ready to Dispatch" + (f" ({r['failed']} refused)" if r["failed"] else ""))
    from .models import MeeshoLabelFile
    note = "" if f.sorted else f.summary.split("\n")[0]
    MeeshoLabelFile.objects.filter(pk=f.pk).update(summary="\n".join(x for x in (note, " · ".join(out["steps"])) if x))
    try:
        fs.refresh(fs.A.objects.get(pk=account.pk), sync=False)       # the orders as they are now, for the page
    except fs.FlipkartError:
        pass
    return out


def _accounts(business_id=None):
    qs = fs.A.objects.filter(status=fs.A.STATUS_ACTIVE).select_related("business").order_by("business__name")
    if business_id:
        qs = qs.filter(business_id=business_id)
    return list(qs)


def run(kind, business_id=None, trigger="AUTO", limit=None, send=None, rtd=None):
    """One run of `kind` ("accept" | "labels") for every connected account (or one business). {business: result}."""
    from .models import FlipkartAutoSetting
    setting = FlipkartAutoSetting.get()
    send = setting.send_labels if send is None else send
    rtd = setting.mark_rtd if rtd is None else rtd
    results = {}
    # One run at a time, across every process (the schedule's, an admin's): claimed on the settings row.
    now = timezone.now()
    if not FlipkartAutoSetting.objects.filter(Q(busy_until__isnull=True) | Q(busy_until__lt=now), pk=setting.pk) \
            .update(busy_until=now + timedelta(seconds=LOCK_TTL)):
        return {"*": {"error": "Another Flipkart run is still going — try again in a minute."}}
    try:
        for a in _accounts(business_id):
            results[a.business.name] = _run_one(a, kind, trigger, limit, send, rtd)
    finally:
        FlipkartAutoSetting.objects.filter(pk=setting.pk).update(busy_until=None)
    return results


def _run_one(a, kind, trigger, limit, send, rtd):
    from . import notify
    try:
        if kind == "accept":
            r = accept(a, limit=limit)
            return {"accepted": r["shipments"], "failed": r["failed"], "errors": r["errors"], "skipped": len(r.get("skipped") or [])}
        return labels(a, trigger=trigger, send=send, rtd=rtd, limit=limit)
    except (fs.FlipkartError, AutoError) as e:
        if getattr(e, "expired", False):
            fa._expired(a, e)
        if kind == "labels" and send:
            notify.send(f"Flipkart labels — {a.business.name}", f"The labels run couldn't finish: {e}")
        return {"error": str(e)}


# ── The schedule ─────────────────────────────────────────────────────────────

def _slot(hhmm, now):
    h, m = (int(x) for x in str(hhmm).split(":")[:2])
    return now.replace(hour=h, minute=m, second=0, microsecond=0)


def due(setting, now=None):
    """("labels", slot) | ("accept", None) | (None, None) — what the schedule should run now."""
    if not setting.enabled:
        return None, None
    now = timezone.localtime(now or timezone.now())
    for t in sorted(setting.label_times or []):
        try:
            slot = _slot(t, now)
        except (ValueError, TypeError):
            continue
        if slot <= now < slot + LABEL_SLOT_GRACE and (not setting.last_labels_at or setting.last_labels_at < slot):
            return "labels", slot
    if setting.accept_every and (not setting.last_accept_at or now - setting.last_accept_at >= timedelta(minutes=setting.accept_every)):
        return "accept", None
    return None, None


def run_due(now=None):
    """What's due, claimed first (so two runs never do one slot twice), then run. Returns what was done."""
    from .models import FlipkartAutoSetting
    setting = FlipkartAutoSetting.get()
    kind, _slot_at = due(setting, now)
    if not kind:
        return {"due": None}
    now = now or timezone.now()
    # A labels run accepts first, so it counts as the accept too.
    claim = {"last_labels_at": now, "last_accept_at": now} if kind == "labels" else {"last_accept_at": now}
    field = "last_labels_at" if kind == "labels" else "last_accept_at"
    if not FlipkartAutoSetting.objects.filter(pk=setting.pk, **{field: getattr(setting, field)}).update(**claim):
        return {"due": kind, "claimed": False}
    results = run(kind)
    FlipkartAutoSetting.objects.filter(pk=setting.pk).update(last_result={"kind": kind, "at": now.isoformat(), "results": results})
    return {"due": kind, "results": results}


# ── API: Business Settings → Flipkart setup → Automation ─────────────────────

def _setting_json(s, business_ids):
    from .models import MeeshoLabelFile
    files = [f for f in MeeshoLabelFile.objects.filter(platform="flipkart").defer("pdf").order_by("-created_at")[:30]
             if set(f.business_ids or []) & set(business_ids)][:5]
    kind, slot = due(s)
    return {"enabled": s.enabled, "accept_every": s.accept_every, "label_times": s.label_times, "send_labels": s.send_labels,
            "mark_rtd": s.mark_rtd, "last_accept_at": s.last_accept_at, "last_labels_at": s.last_labels_at,
            "last_result": s.last_result, "due_now": kind,
            "files": [{"id": f.pk, "created_at": f.created_at, "labels": f.labels, "pages": f.pages, "trigger": f.trigger,
                       "businesses": f.business_names, "summary": f.summary} for f in files]}


@api_view(["GET", "PATCH"])
def auto_view(request, business_id):
    """GET / PATCH flipkart-seller/auto/ — the automation's settings (an admin changes them)."""
    from . import views
    from .models import FlipkartAutoSetting
    business = views.get_authorized_business(request, business_id)
    s = FlipkartAutoSetting.get()
    if request.method == "PATCH":
        if not views._is_admin(request.user):
            return Response({"error": "Only an admin can change the automation."}, status=status.HTTP_403_FORBIDDEN)
        d = request.data if isinstance(request.data, dict) else {}
        try:
            if "accept_every" in d:
                n = int(d["accept_every"])
                if not (n == 0 or 10 <= n <= 240):
                    return Response({"error": "Accept every 10 to 240 minutes (or 0 for never)."}, status=status.HTTP_400_BAD_REQUEST)
                s.accept_every = n
            if "label_times" in d:
                times = sorted({f"{_slot(t, timezone.localtime()):%H:%M}" for t in d["label_times"] or []})
                s.label_times = times[:8]
        except (ValueError, TypeError):
            return Response({"error": "A time is HH:MM, e.g. 17:00."}, status=status.HTTP_400_BAD_REQUEST)
        for k in ("enabled", "send_labels", "mark_rtd"):
            if k in d:
                setattr(s, k, bool(d[k]))
        s.save()
    return Response(_setting_json(s, [b.pk for b in views.accessible_businesses(request, include=business)]))


@api_view(["POST"])
def auto_run_view(request, business_id):
    """
    POST flipkart-seller/auto/run/ {business, kind: "labels" | "accept", limit?, send?, rtd?} — an admin runs it now
    for one business. limit 1 is the one-order test: accept one order, print its label, mark it RTD.
    """
    from . import views
    business = views.get_authorized_business(request, business_id)
    if not views._is_admin(request.user):
        return Response({"error": "Only an admin can run the automation."}, status=status.HTTP_403_FORBIDDEN)
    d = request.data if isinstance(request.data, dict) else {}
    kind = d.get("kind") or "labels"
    if kind not in ("labels", "accept"):
        return Response({"error": "kind is labels or accept."}, status=status.HTTP_400_BAD_REQUEST)
    target = int(d.get("business") or business.pk)
    if target not in {b.pk for b in views.accessible_businesses(request, include=business)}:
        return Response({"error": "Not your business."}, status=status.HTTP_403_FORBIDDEN)
    limit = int(d["limit"]) if d.get("limit") else None
    results = run(kind, business_id=target, trigger="MANUAL", limit=limit,
                  send=d.get("send") if "send" in d else None, rtd=d.get("rtd") if "rtd" in d else None)
    if not results:
        return Response({"error": "Flipkart isn't connected for this business."}, status=status.HTTP_404_NOT_FOUND)
    failed = any("error" in r for r in results.values())
    return Response({"results": results}, status=status.HTTP_207_MULTI_STATUS if failed else status.HTTP_200_OK)
