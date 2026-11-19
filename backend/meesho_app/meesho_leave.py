"""
Leave (Meesho Inventory → Leave): every catalog live on Meesho paused for a while,
kept paused (checked every hour), and brought back at the end — or when someone
ends it. The work is the sync worker's (MeeshoLeaveJob, queued by
MeeshoScheduleJob); this is the page's API. See models.MeeshoLeave.

  GET    meesho-leave/                  each business's leave now, and the past ones
  POST   meesho-leave/                  {businesses: [id], starts_at?, ends_at?, note?} — admin
  PATCH  meesho-leave/<id>/             {ends_at} — change when it ends (empty: until ended by hand)
  POST   meesho-leave/<id>/end/         end it now (a scheduled one is cancelled); after an end with
                                        SKUs not brought back, the same brings the rest back
  GET    meesho-leave/<id>/items/       every SKU it paused and where it stands
"""

from datetime import datetime

from django.db.models import Count
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import meesho_sync
from .models import MeeshoAccount, MeeshoLeave, MeeshoLeaveItem

JOB = "MeeshoLeaveJob"


def _views():
    from . import views
    return views


def _when(v, field):
    """An ISO date-time from the page (its own time zone), or None for empty."""
    if v in (None, ""):
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(f"{field} isn't a date and time.")
    return d if timezone.is_aware(d) else timezone.make_aware(d)


def _counts(leave):
    return dict(leave.items.values_list("state").annotate(n=Count("id")).values_list("state", "n"))


def _json(l, counts=None):
    counts = counts if counts is not None else _counts(l)
    return {
        "id": l.id, "business": l.account.business_id, "business_name": l.account.business.name, "status": l.status,
        "starts_at": l.starts_at, "ends_at": l.ends_at, "note": l.note, "message": l.message, "ended_how": l.ended_how,
        "paused_at": l.paused_at, "resumed_at": l.resumed_at, "last_guard_at": l.last_guard_at, "repaused": l.repaused,
        "created_by": getattr(l.created_by, "username", ""), "ended_by": getattr(l.ended_by, "username", ""),
        "counts": counts, "skus": sum(counts.values()),
        "catalogs": l.items.values("catalog_id").distinct().count(),
        "can_retry": l.status == MeeshoLeave.ENDED and bool(counts.get(MeeshoLeaveItem.PAUSED) or counts.get(MeeshoLeaveItem.RESUME_FAILED)),
    }


def _mine(request, business_id):
    business = _views().get_authorized_business(request, business_id)
    _desk, accounts = meesho_sync._inventory_accounts(request, business)
    return business, accounts


@api_view(["GET", "POST"])
def leaves_view(request, business_id):
    business, accounts = _mine(request, business_id)
    if request.method == "GET":
        leaves = list(MeeshoLeave.objects.filter(account__in=accounts).select_related("account__business", "created_by", "ended_by")[:60])
        open_by = {l.account_id: l for l in leaves if l.status in MeeshoLeave.OPEN}
        return Response({
            "is_admin": _views()._is_admin(request.user),
            "businesses": [{"business": a.business_id, "business_name": a.business.name,
                            "connected": a.status == MeeshoAccount.STATUS_ACTIVE,
                            "leave": _json(open_by[a.id]) if a.id in open_by else None} for a in accounts],
            "past": [_json(l) for l in leaves if l.status not in MeeshoLeave.OPEN][:30],
        })

    if not _views()._is_admin(request.user):
        return Response({"error": "Only an admin can put a business on leave."}, status=status.HTTP_403_FORBIDDEN)
    d = request.data if isinstance(request.data, dict) else {}
    try:
        starts = _when(d.get("starts_at"), "Start") or timezone.now()
        ends = _when(d.get("ends_at"), "End")
    except ValueError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    if ends and ends <= max(starts, timezone.now()):
        return Response({"error": "The leave has to end after it starts (and after now)."}, status=status.HTTP_400_BAD_REQUEST)
    wanted = {int(x) for x in d.get("businesses") or [] if str(x).isdigit()}
    chosen = [a for a in accounts if a.business_id in wanted]
    if not chosen:
        return Response({"error": "Choose the businesses to put on leave."}, status=status.HTTP_400_BAD_REQUEST)
    for a in chosen:
        if a.status != MeeshoAccount.STATUS_ACTIVE:
            return Response({"error": f"{a.business.name}: the Meesho account isn't connected — log in under Business Settings → Meesho setup."},
                            status=status.HTTP_400_BAD_REQUEST)
        if MeeshoLeave.objects.filter(account=a, status__in=MeeshoLeave.OPEN).exists():
            return Response({"error": f"{a.business.name} is already on leave (or has one set) — end or change that one."},
                            status=status.HTTP_409_CONFLICT)
    made = []
    for a in chosen:
        l = MeeshoLeave.objects.create(account=a, starts_at=starts, ends_at=ends, note=str(d.get("note") or "")[:200],
                                       created_by=request.user, message="Starts at the time set." if starts > timezone.now() else "Starting…")
        # Starting now: queued at once (claimed first); a later start, or a queue that can't be reached, is
        # picked up by the worker's minute tick.
        if starts <= timezone.now() and MeeshoLeave.objects.filter(pk=l.pk, status=MeeshoLeave.SCHEDULED).update(
                status=MeeshoLeave.PAUSING, message="Pausing every live catalog…"):
            try:
                meesho_sync.enqueue(JOB, [a.pk, l.pk, "start"], queue="critical", retry=False)
            except Exception:                           # noqa: BLE001 — the minute tick starts it
                MeeshoLeave.objects.filter(pk=l.pk).update(status=MeeshoLeave.SCHEDULED, message="Starting within a minute…")
        l.refresh_from_db()
        made.append(_json(l, {}))
    return Response({"leaves": made}, status=status.HTTP_201_CREATED)


def _one(request, business_id, leave_id):
    business, accounts = _mine(request, business_id)
    l = MeeshoLeave.objects.filter(pk=leave_id, account__in=accounts).select_related("account__business").first()
    return l


@api_view(["PATCH"])
def leave_view(request, business_id, leave_id):
    l = _one(request, business_id, leave_id)
    if not l:
        return Response({"error": "No such leave."}, status=status.HTTP_404_NOT_FOUND)
    if not _views()._is_admin(request.user):
        return Response({"error": "Only an admin can change a leave."}, status=status.HTTP_403_FORBIDDEN)
    if l.status not in (MeeshoLeave.SCHEDULED, MeeshoLeave.PAUSING, MeeshoLeave.ON_LEAVE):
        return Response({"error": "This leave is over."}, status=status.HTTP_409_CONFLICT)
    try:
        ends = _when((request.data or {}).get("ends_at"), "End")
    except ValueError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    if ends and ends <= max(l.starts_at, timezone.now()):
        return Response({"error": "The leave has to end after it starts (and after now)."}, status=status.HTTP_400_BAD_REQUEST)
    l.ends_at = ends
    l.save(update_fields=["ends_at", "updated_at"])
    return Response(_json(l))


@api_view(["POST"])
def leave_end_view(request, business_id, leave_id):
    """End now — or cancel one not started; after an end that left SKUs paused, bring those back."""
    l = _one(request, business_id, leave_id)
    if not l:
        return Response({"error": "No such leave."}, status=status.HTTP_404_NOT_FOUND)
    if not _views()._is_admin(request.user):
        return Response({"error": "Only an admin can end a leave."}, status=status.HTTP_403_FORBIDDEN)
    if l.status == MeeshoLeave.SCHEDULED:
        MeeshoLeave.objects.filter(pk=l.pk, status=MeeshoLeave.SCHEDULED).update(
            status=MeeshoLeave.CANCELLED, ended_how="manual", ended_by=request.user, message="Cancelled before it started — nothing was paused.")
        l.refresh_from_db()
        return Response(_json(l))
    if l.status in (MeeshoLeave.PAUSING, MeeshoLeave.RESUMING):
        return Response({"error": "It's pausing or bringing back right now — wait a minute and try again."}, status=status.HTTP_409_CONFLICT)
    retry = l.status == MeeshoLeave.ENDED
    if retry and not _json(l)["can_retry"]:
        return Response({"error": "Everything this leave paused is back already."}, status=status.HTTP_409_CONFLICT)
    if not MeeshoLeave.objects.filter(pk=l.pk, status=l.status).update(
            status=MeeshoLeave.RESUMING, ended_by=request.user,
            ended_how=l.ended_how if retry else "manual", message="Bringing every catalog back…"):
        return Response({"error": "It changed just now — look again."}, status=status.HTTP_409_CONFLICT)
    try:
        meesho_sync.enqueue(JOB, [l.account_id, l.pk, "end"], queue="critical", retry=False)
    except Exception as exc:                            # noqa: BLE001
        MeeshoLeave.objects.filter(pk=l.pk).update(status=l.status, message=l.message)
        return Response({"error": f"The sync worker can't be reached ({exc.__class__.__name__}) — try again."},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)
    l.refresh_from_db()
    return Response(_json(l), status=status.HTTP_202_ACCEPTED)


@api_view(["GET"])
def leave_items_view(request, business_id, leave_id):
    l = _one(request, business_id, leave_id)
    if not l:
        return Response({"error": "No such leave."}, status=status.HTTP_404_NOT_FOUND)
    rows = list(l.items.order_by("catalog_id", "sku_id", "variation_id")[:3000])
    return Response({"leave": _json(l), "items": [{
        "catalog_id": x.catalog_id, "product_id": x.product_id, "variation_id": x.variation_id, "sku_id": x.sku_id,
        "variation": x.variation, "stock": x.previous_inventory, "state": x.state, "message": x.message,
        "times_repaused": x.times_repaused, "paused_at": x.paused_at, "resumed_at": x.resumed_at} for x in rows]})
