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

def _print_body(account, chunk, dbd, reprint=False):
    """Print's body, as the page sends it — a breached bucket's with is_breached; a dated one's groups with their date.
    A reprint (labels printed already, waiting RTD) is sent with status pendingRTD, as Seller Hub's Reprint does."""
    body = {
        "timestamp": fa._now(), "status": fa.STAGES["rtd" if reprint else "label"], "view": "group_shipment", "shipment_ids": [],
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
        r = s.post(f"{fs.BASE}{PRINT_PATH}?reprint={'true' if reprint else 'false'}", json=_print_body(account, groups_, dbd, reprint),
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
                 .values_list("pk", flat=True)[MeeshoLabelFile.KEEP_FLIPKART:])
    if stale:
        MeeshoLabelFile.objects.filter(pk__in=stale).delete()
    return f


def labels(account, trigger="AUTO", send=True, rtd=None, limit=None, accept_first=True, wait=None):
    """
    Accept (first), print every label waiting, keep the PDF, send it, mark those groups RTD.
    `limit`: only groups of at most that many shipments, the ones just accepted first (the one-order test).
    `rtd`: mark the printed ones RTD now — by default as the business is set (rtd_mode "print"); a "scan"
    business gets its packed groups marked RTD instead (rtd_scanned).
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
    if rtd is None:
        rtd = account.rtd_mode == fs.A.RTD_PRINT
    if not rtd and account.rtd_mode == fs.A.RTD_SCAN:
        # Orders packed at the desk before their label was printed: marked RTD now, once their whole group is packed.
        try:
            done = rtd_scanned(account, s)
            if done["marked"]:
                out["rtd"] = done["marked"]
            out["steps"].append(f"RTD on scan: {done['marked']} marked (every order of their group packed)"
                                + (f", {sum(w['shipments'] - w['packed'] for w in done['waiting'])} still to pack" if done["waiting"] else ""))
        except fs.FlipkartError as e:
            out["steps"].append(f"RTD on scan: couldn't check now ({e}) — the next scan or minute tries again")
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


def _order_ids(g):
    return [x["orderId"] for x in g.get("sellerInputAttributes") or [] if x.get("orderId")]


def rtd_scanned(account, s=None):
    """
    RTD on scan: every group printed and waiting RTD whose orders are ALL packed at the scan desk (Flipkart
    scans, by Flipkart order id — the "OD…" on the label) is marked Ready to Dispatch; a group still being
    packed waits. Seller Hub marks RTD by group (same product, same dispatch-by), so a group goes when its
    last order is packed. Returns {"marked", "groups", "waiting": [{group, sku, shipments, packed}], "errors"}.
    """
    fa._need_location(account)
    s = s or fs._load(account, fs._http())
    look = rtd_scanned_preview(account, s)
    ready, still = look["ready"], look["waiting"]
    out = {"marked": 0, "groups": len(ready), "ready": ready, "waiting": still, "errors": []}
    if ready:
        r = fa.act(account, "rtd", wanted=[g["group_id"] for g in ready], s=s)
        out["marked"] = r["shipments"] - r["failed"]
        out["errors"] = r["errors"] + [x["error"] for res in r["results"] for x in res["failed"]][:5]
    return out


def rtd_pass(now=None):
    """
    Every minute (run_due): for each business set to RTD on scan, when there are Flipkart scans since it was
    last checked, mark RTD the groups now wholly packed — claimed per account first, so two runs never do one.
    """
    from .models import ScannedOrder
    now = now or timezone.now()
    done = {}
    for a in _accounts():
        if a.rtd_mode != fs.A.RTD_SCAN:
            continue
        since = a.rtd_checked_at
        fresh = ScannedOrder.objects.filter(platform="flipkart")
        if since:
            fresh = fresh.filter(last_scanned_at__gt=since)
        if not fresh.exists():
            continue
        if not fs.A.objects.filter(pk=a.pk, rtd_checked_at=since).update(rtd_checked_at=now):
            continue                                   # another run took it
        started = timezone.now()
        try:
            r = rtd_scanned(a)
        except fs.FlipkartError as e:
            if getattr(e, "expired", False):
                fa._expired(a, e)
            fs.A.objects.filter(pk=a.pk).update(rtd_checked_at=since)   # not checked after all: the next minute tries again
            done[a.business.name] = {"error": str(e)}
            continue
        if r["marked"] or r["errors"]:
            _record(a, "rtd", "AUTO", started, {"rtd": r["marked"], "steps": [
                f"Marked {r['marked']} Ready to Dispatch — every order of their group packed at the scan desk"]
                + ([f"Refused: {'; '.join(r['errors'])}"] if r["errors"] else [])})
        done[a.business.name] = {"marked": r["marked"], "waiting": len(r["waiting"])}
    return done


def reprint(account, trigger="MANUAL", wanted=None):
    """
    The labels of orders already printed and waiting to be marked RTD, again — Seller Hub's Reprint
    (?reprint=true, status pendingRTD) — kept as a labels file, like any other. Nothing is marked RTD.
    `wanted`: only these groups.
    """
    fa._need_location(account)
    s = fs._load(account, fs._http())
    out = {"business": account.business.name, "accepted": 0, "printed": 0, "rtd": 0, "file_id": None, "steps": []}
    waiting = _waiting(account, s, "rtd")
    if wanted:
        waiting = [(d, g) for d, g in waiting if g["groupId"] in set(wanted)]
    if not waiting:
        out["steps"].append("Nothing to reprint — no order is printed and waiting to be marked RTD")
        return out
    pdf, waiting, failed = print_labels(account, s, waiting, reprint=True)
    if not pdf:
        raise fs.FlipkartError(f"Flipkart didn't send the labels again ({failed[0][1] if failed else 'no answer'}).")
    out["printed"] = sum(g.get("shipmentCount") or 0 for _d, g in waiting)
    out["not_printed"] = [{"group_id": g["groupId"], "orders": g.get("shipmentCount") or 0, "why": w} for g, w in failed]
    out["steps"].append(f"Reprinted {out['printed']} label{'' if out['printed'] == 1 else 's'}")
    f = _keep(account, pdf, trigger, out["printed"], " · ".join(out["steps"]))
    out["file_id"] = f.pk
    return out


def _record(account, kind, trigger, started, out=None, error=None):
    """Keep how one labels run went, for the history (FlipkartLabelRun)."""
    from .models import FlipkartLabelRun, MeeshoLabelFile
    out = out or {}
    not_printed = sum(x["orders"] for x in out.get("not_printed") or [])
    status = (FlipkartLabelRun.STATUS_FAILED if error else FlipkartLabelRun.STATUS_PARTIAL if not_printed
              else FlipkartLabelRun.STATUS_OK if out.get("printed") else FlipkartLabelRun.STATUS_EMPTY)
    try:
        FlipkartLabelRun.objects.create(
            business_id=account.business_id, kind=kind, trigger=trigger, status=status, started_at=started,
            finished_at=timezone.now(), accepted=out.get("accepted") or 0, printed=out.get("printed") or 0,
            rtd=out.get("rtd") or 0, not_printed=not_printed, error=str(error or "")[:2000], steps=out.get("steps") or [],
            file=MeeshoLabelFile.objects.filter(pk=out.get("file_id")).first() if out.get("file_id") else None)
    except Exception:                                  # noqa: BLE001 — the history never stops a run
        pass


def _accounts(business_id=None):
    qs = fs.A.objects.filter(status=fs.A.STATUS_ACTIVE).select_related("business").order_by("business__name")
    if business_id:
        qs = qs.filter(business_id=business_id)
    return list(qs)


def run(kind, business_id=None, trigger="AUTO", limit=None, send=None, rtd=None):
    """One run of `kind` ("accept" | "labels" | "reprint") for every connected account (or one business). {business: result}."""
    from .models import FlipkartAutoSetting
    setting = FlipkartAutoSetting.get()
    send = setting.send_labels if send is None else send       # rtd None: as each business is set (rtd_mode)
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
    started = timezone.now()
    try:
        if kind == "accept":
            r = accept(a, limit=limit)
            return {"accepted": r["shipments"], "failed": r["failed"], "errors": r["errors"], "skipped": len(r.get("skipped") or [])}
        out = reprint(a, trigger=trigger) if kind == "reprint" else labels(a, trigger=trigger, send=send, rtd=rtd, limit=limit)
        _record(a, kind, trigger, started, out)
        return out
    except (fs.FlipkartError, AutoError) as e:
        if getattr(e, "expired", False):
            fa._expired(a, e)
        if kind != "accept":
            _record(a, kind, trigger, started, error=e)
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
        return {"due": None, "rtd": _rtd_pass_locked(setting, now)}
    now = now or timezone.now()
    # A labels run accepts first, so it counts as the accept too.
    claim = {"last_labels_at": now, "last_accept_at": now} if kind == "labels" else {"last_accept_at": now}
    field = "last_labels_at" if kind == "labels" else "last_accept_at"
    if not FlipkartAutoSetting.objects.filter(pk=setting.pk, **{field: getattr(setting, field)}).update(**claim):
        return {"due": kind, "claimed": False}
    results = run(kind)
    FlipkartAutoSetting.objects.filter(pk=setting.pk).update(last_result={"kind": kind, "at": now.isoformat(), "results": results})
    return {"due": kind, "results": results, "rtd": _rtd_pass_locked(setting, now)}


def _rtd_pass_locked(setting, now=None):
    """The RTD-on-scan pass, under the same one-run-at-a-time claim as the labels runs (skipped while one is going:
    a labels run checks the scans itself)."""
    from .models import FlipkartAutoSetting
    t = timezone.now()
    if not FlipkartAutoSetting.objects.filter(Q(busy_until__isnull=True) | Q(busy_until__lt=t), pk=setting.pk) \
            .update(busy_until=t + timedelta(minutes=5)):
        return {"skipped": "a run is going"}
    try:
        return rtd_pass(now)
    finally:
        FlipkartAutoSetting.objects.filter(pk=setting.pk).update(busy_until=None)


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


@api_view(["POST"])
def reprint_view(request, business_id):
    """POST flipkart-seller/auto/reprint/ {business} — the labels of orders printed and waiting RTD, again; kept."""
    from . import views
    business = views.get_authorized_business(request, business_id)
    d = request.data if isinstance(request.data, dict) else {}
    target = int(d.get("business") or business.pk)
    if target not in {b.pk for b in views.accessible_businesses(request, include=business)}:
        return Response({"error": "Not your business."}, status=status.HTTP_403_FORBIDDEN)
    results = run("reprint", business_id=target, trigger="MANUAL")
    if not results:
        return Response({"error": "Flipkart isn't connected for this business."}, status=status.HTTP_404_NOT_FOUND)
    failed = any("error" in r for r in results.values())
    return Response({"results": results}, status=status.HTTP_207_MULTI_STATUS if failed else status.HTTP_200_OK)


@api_view(["GET"])
def label_runs_view(request, business_id):
    """
    GET flipkart-seller/label-runs/?days=30 — every Flipkart labels run of the businesses this person sees,
    newest first, each with its PDF (when one was made), and the totals — Overview → Flipkart → Labels.
    """
    from datetime import timedelta as _td
    from . import views
    from .models import FlipkartLabelRun, FlipkartSellerAccount
    business = views.get_authorized_business(request, business_id)
    try:
        days = max(1, min(120, int(request.GET.get("days") or 30)))
    except ValueError:
        days = 30
    biz = [b.pk for b in views.accessible_businesses(request, include=business)]
    since = timezone.now() - _td(days=days)
    runs = list(FlipkartLabelRun.objects.filter(business_id__in=biz, started_at__gte=since)
                .select_related("business", "file").defer("file__pdf")[:500])
    today = timezone.localdate()
    def total(rs):
        return {"runs": len(rs), "printed": sum(r.printed for r in rs), "rtd": sum(r.rtd for r in rs),
                "accepted": sum(r.accepted for r in rs), "not_printed": sum(r.not_printed for r in rs),
                "failed": sum(1 for r in rs if r.status == FlipkartLabelRun.STATUS_FAILED)}
    accounts = FlipkartSellerAccount.objects.filter(business_id__in=biz).select_related("business")
    return Response({
        "days": days,
        "totals": total(runs),
        "today": total([r for r in runs if timezone.localtime(r.started_at).date() == today]),
        "businesses": [{"business": a.business_id, "business_name": a.business.name, "connected": a.status == fs.A.STATUS_ACTIVE}
                       for a in accounts],
        "runs": [{
            "id": r.id, "business": r.business_id, "business_name": r.business.name, "kind": r.kind, "trigger": r.trigger,
            "status": r.status, "started_at": r.started_at, "finished_at": r.finished_at, "accepted": r.accepted,
            "printed": r.printed, "rtd": r.rtd, "not_printed": r.not_printed, "error": r.error, "steps": r.steps,
            "file": {"id": r.file.pk, "labels": r.file.labels, "pages": r.file.pages, "sorted": r.file.sorted,
                     "name": f"flipkart-labels-{timezone.localtime(r.file.created_at):%Y-%m-%d-%H%M}.pdf"} if r.file_id else None,
        } for r in runs],
    })


def _rtd_target(request, business_id):
    from . import views
    business = views.get_authorized_business(request, business_id)
    d = request.data if isinstance(request.data, dict) else {}
    target = int(d.get("business") or request.GET.get("business") or business.pk)
    if target not in {b.pk for b in views.accessible_businesses(request, include=business)}:
        return None, Response({"error": "Not your business."}, status=status.HTTP_403_FORBIDDEN)
    a = fs.A.objects.filter(business_id=target).select_related("business").first()
    if not a:
        return None, Response({"error": "Flipkart isn't connected for this business."}, status=status.HTTP_404_NOT_FOUND)
    return a, None


@api_view(["PATCH"])
def rtd_mode_view(request, business_id):
    """PATCH flipkart-seller/rtd-mode/ {business, mode: scan | print | off} — when this business's orders are marked RTD."""
    from . import views
    if not views._is_admin(request.user):
        return Response({"error": "Only an admin can change this."}, status=status.HTTP_403_FORBIDDEN)
    a, err = _rtd_target(request, business_id)
    if err:
        return err
    mode = (request.data or {}).get("mode")
    if mode not in fs.A.RTD_MODES:
        return Response({"error": "mode is scan, print or off."}, status=status.HTTP_400_BAD_REQUEST)
    a.rtd_mode = mode
    a.save(update_fields=["rtd_mode", "updated_at"])
    return Response({"business": a.business_id, "rtd_mode": a.rtd_mode})


@api_view(["GET", "POST"])
def rtd_scan_view(request, business_id):
    """
    GET flipkart-seller/rtd-scan/?business= — Order Scan → Flipkart → Ready to dispatch: each group printed and
    waiting RTD, with how many of its orders are packed; POST — mark RTD now the groups wholly packed.
    """
    from .models import FlipkartLabelRun
    a, err = _rtd_target(request, business_id)
    if err:
        return err
    if a.status != fs.A.STATUS_ACTIVE:
        return Response({"error": f"Flipkart isn't connected for {a.business.name} — log in again."}, status=status.HTTP_409_CONFLICT)
    started = timezone.now()
    try:
        if request.method == "POST":
            r = rtd_scanned(a)
            if r["marked"] or r["errors"]:
                _record(a, "rtd", "MANUAL", started, {"rtd": r["marked"], "steps": [f"Marked {r['marked']} Ready to Dispatch (by hand)"]})
        else:
            # Only look — nothing is marked: what's printed and waiting, and what of it is packed.
            s = fs._load(a, fs._http())
            r = rtd_scanned_preview(a, s)
    except fs.FlipkartError as e:
        if getattr(e, "expired", False):
            fa._expired(a, e)
        return Response({"error": str(e)}, status=status.HTTP_409_CONFLICT)
    today = timezone.localdate()
    marked_today = sum(x.rtd for x in FlipkartLabelRun.objects.filter(business_id=a.business_id, started_at__date__gte=today - timedelta(days=1))
                       if timezone.localtime(x.started_at).date() == today)
    return Response({"business": a.business_id, "business_name": a.business.name, "rtd_mode": a.rtd_mode,
                     "marked": r.get("marked", 0), "ready": r.get("ready", []), "waiting": r["waiting"],
                     "errors": r.get("errors", []), "marked_today": marked_today})


def rtd_scanned_preview(account, s):
    """rtd_scanned without marking: {"ready": [groups wholly packed], "waiting": [...]}."""
    from .models import ScannedOrder
    waiting = _waiting(account, s, "rtd")
    ids = {o for _d, g in waiting for o in _order_ids(g)}
    packed = set(ScannedOrder.objects.filter(platform="flipkart", sub_order_no__in=ids,
                                             status__in=(ScannedOrder.STATUS_PACKED, ScannedOrder.STATUS_DISPATCHED))
                 .values_list("sub_order_no", flat=True)) if ids else set()
    ready, still = [], []
    for dbd, g in waiting:
        oids = set(_order_ids(g))
        n = g.get("shipmentCount") or 0
        specs = (g.get("groupDetails") or {}).get("shipmentGroupSpecs") or []
        row = {"group_id": g["groupId"], "dispatch_by": dbd, "shipments": n, "packed": len(oids & packed),
               "sku": ", ".join(((x.get("listing") or {}).get("product") or {}).get("sku") or "" for x in specs),
               "image": next((((x.get("listing") or {}).get("product") or {}).get("primaryImageUrl") for x in specs), ""),
               "orders": sorted(oids), "packed_orders": sorted(oids & packed)}
        (ready if oids and oids <= packed and len(oids) >= n else still).append(row)
    return {"ready": ready, "waiting": still}
