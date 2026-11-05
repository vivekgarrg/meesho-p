"""
Orders Panel — every Meesho order the worker last pulled, across the
businesses on this person's desk: what is still to accept, which labels are
still to download, what's downloaded and waiting for pickup, what shipped and
what got cancelled — and how many orders each dispatch day has.

Days follow the packing-day cutoff the rest of the app uses
(views.PACKING_DAY_STARTS, IST): an order placed before the cutoff ships that
day, one placed after it ships the next day. So "Today" is the orders from
yesterday's cutoff to today's, and "Tomorrow" is everything since today's.

Read only from the sync's snapshots (MeeshoSyncSnapshot) — no Meesho calls.
"""

from datetime import datetime, timedelta

from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import MeeshoAccount, MeeshoAutoSetting, MeeshoSyncSnapshot

PANEL_PATH = "meesho-orders/panel/"
DAYS_BACK = 7                 # dispatch days shown before today
ROWS_MAX = 5000

# Each order's place in the flow, furthest along wins when a sub-order sits
# in two snapshots pulled at slightly different times.
S_HOLD, S_ACCEPT, S_DOWNLOAD, S_DOWNLOADED, S_SHIPPED, S_CANCELLED = (
    "on_hold", "to_accept", "to_download", "downloaded", "shipped", "cancelled")
STATUSES = [
    (S_ACCEPT, "To accept"),
    (S_HOLD, "On hold"),
    (S_DOWNLOAD, "Label to download"),
    (S_DOWNLOADED, "Label downloaded"),
    (S_SHIPPED, "Shipped"),
    (S_CANCELLED, "Cancelled"),
]
_RANK = {S_HOLD: 0, S_ACCEPT: 1, S_DOWNLOAD: 2, S_DOWNLOADED: 3, S_SHIPPED: 4, S_CANCELLED: 5}
OPEN = (S_HOLD, S_ACCEPT, S_DOWNLOAD, S_DOWNLOADED)   # still with us
TABS = ("hold", "pending", "ready_to_ship", "shipped", "cancelled")


def _views():
    from . import views
    return views


def _now():
    return timezone.localtime()


def _status(tab, row):
    if tab == "hold":
        return S_HOLD
    if tab == "pending":
        return S_ACCEPT
    if tab == "ready_to_ship":
        return S_DOWNLOADED if row.get("label") == "Downloaded" else S_DOWNLOAD
    return S_SHIPPED if tab == "shipped" else S_CANCELLED


def _created(iso):
    """Meesho's created_iso ("2026-11-04T09:01:15+0530") as local time, or None."""
    if not iso:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z"):
        try:
            return timezone.localtime(datetime.strptime(iso, fmt))
        except (TypeError, ValueError):
            pass
    try:
        d = datetime.fromisoformat(iso)
        return timezone.localtime(d) if d.tzinfo else timezone.make_aware(d)
    except (TypeError, ValueError):
        return None


def ship_day(at, cutoff):
    """The day an order placed at `at` (local) ships: that day before the cutoff, else the next."""
    return at.date() if at.hour < cutoff else at.date() + timedelta(days=1)


def _blank_day(day, cutoff):
    start = timezone.make_aware(datetime.combine(day - timedelta(days=1), datetime.min.time()).replace(hour=cutoff))
    return {"date": day.isoformat(), "from": start, "to": start + timedelta(days=1),
            "total": 0, "quantity": 0, **{k: 0 for k, _ in STATUSES}, "by_business": {}}


@api_view(["GET"])
def orders_panel(request, business_id):
    v = _views()
    from . import meesho_sync
    from .meesho_linking import _courier_names

    business = v.get_authorized_business(request, business_id)
    desk = v._scan_desk_scope(request, business, api_path=PANEL_PATH)
    accounts = list(MeeshoAccount.objects.filter(business__in=desk).select_related("business"))
    cutoff = v.PACKING_DAY_STARTS
    now = _now()
    today = now.date()
    # The day the orders coming in right now ship on.
    incoming = ship_day(now, cutoff)
    couriers = _courier_names()

    orders = {}
    fetched = {}
    for s in (MeeshoSyncSnapshot.objects.filter(account__in=accounts, endpoint__in=[f"orders_{t}" for t in TABS])
              .select_related("account__business")):
        tab = s.endpoint[len("orders_"):]
        biz = s.account.business
        f = fetched.setdefault(biz.pk, {"business": biz.name, "tabs": {}})
        f["tabs"][tab] = s.fetched_at
        for r in (s.payload if isinstance(s.payload, list) else []):
            if not isinstance(r, dict):
                continue
            st = _status(tab, r)
            key = (biz.pk, r.get("sub_order_num") or f"{tab}-{len(orders)}")
            if key in orders and _RANK[orders[key]["status"]] >= _RANK[st]:
                continue
            at = _created(r.get("created_iso"))
            try:
                qty = int(r.get("quantity") or 1)
            except (TypeError, ValueError):
                qty = 1
            orders[key] = {
                "business_id": biz.pk, "business_name": biz.name, "status": st,
                "sub_order_num": r.get("sub_order_num"), "order_num": r.get("order_num"),
                "sku": r.get("sku") or "", "product_name": r.get("product_name") or "", "variation": r.get("variation") or "",
                "image": r.get("image"), "quantity": qty,
                "created_at": at.isoformat() if at else None,
                "ship_day": ship_day(at, cutoff).isoformat() if at else None,
                "dispatch_by": r.get("dispatch_by"), "sla_status": r.get("sla_status"),
                "awb": r.get("awb"), "courier": couriers.get(r.get("carrier_id"), "") if r.get("carrier_id") else "",
                "express": bool(r.get("is_express")),
            }

    rows = list(orders.values())
    first = incoming - timedelta(days=DAYS_BACK + (1 if incoming > today else 0))
    days = {}
    d = first
    while d <= incoming:
        days[d.isoformat()] = _blank_day(d, cutoff)
        d += timedelta(days=1)

    totals = {k: 0 for k, _ in STATUSES}
    qty_open = 0
    due = {"overdue": 0, "today": 0, "tomorrow": 0, "later": 0, "unknown": 0}
    sla = {"breached": 0, "breaching_soon": 0}
    by_business = {}
    by_courier = {}
    skus = {}
    t_iso, tm_iso = today.isoformat(), (today + timedelta(days=1)).isoformat()
    for r in rows:
        st = r["status"]
        b = by_business.setdefault(r["business_name"], {"business": r["business_name"], **{k: 0 for k, _ in STATUSES}})
        b[st] += 1
        day = days.get(r["ship_day"] or "")
        if day:
            day["total"] += 1
            day["quantity"] += r["quantity"]
            day[st] += 1
            day["by_business"][r["business_name"]] = day["by_business"].get(r["business_name"], 0) + 1
        if st not in OPEN:
            continue
        totals[st] += 1
        qty_open += r["quantity"]
        db = r["dispatch_by"]
        due["unknown" if not db else "overdue" if db < t_iso else "today" if db == t_iso
            else "tomorrow" if db == tm_iso else "later"] += 1
        s = str(r["sla_status"] or "")
        sla["breached"] += "breach" in s and "soon" not in s
        sla["breaching_soon"] += s == "breaching_soon"
        if st in (S_DOWNLOAD, S_DOWNLOADED):
            c = by_courier.setdefault(r["courier"] or "Courier not assigned yet",
                                      {"courier": r["courier"] or "Courier not assigned yet", S_DOWNLOAD: 0, S_DOWNLOADED: 0})
            c[st] += 1
        k = skus.setdefault(r["sku"] or "—", {"sku": r["sku"] or "—", "product_name": r["product_name"], "image": r["image"],
                                               "orders": 0, "quantity": 0, S_ACCEPT: 0, S_DOWNLOAD: 0, S_DOWNLOADED: 0, S_HOLD: 0})
        k["orders"] += 1
        k["quantity"] += r["quantity"]
        k[st] += 1
    # Shipped / cancelled: today's dispatch day (and, past the cutoff, tomorrow's so far).
    for k in (S_SHIPPED, S_CANCELLED):
        totals[k] = sum(days[x.isoformat()][k] for x in {today, incoming} if x.isoformat() in days)

    # The open ones first (furthest from done first, oldest first), then what's done, newest first.
    open_rows = sorted((r for r in rows if r["status"] in OPEN), key=lambda r: (_RANK[r["status"]], r["created_at"] or ""))
    done_rows = sorted((r for r in rows if r["status"] not in OPEN and r["ship_day"] and r["ship_day"] >= first.isoformat()),
                       key=lambda r: r["created_at"] or "", reverse=True)

    setting = MeeshoAutoSetting.get()
    nxt_accept, nxt_labels = meesho_sync._next_times(setting)
    stamps = [t for f in fetched.values() for t in f["tabs"].values()]
    return Response({
        "now": now, "today": t_iso, "incoming_day": incoming.isoformat(), "cutoff_hour": cutoff,
        "businesses": [{"id": b.pk, "name": b.name, "connected": any(a.business_id == b.pk for a in accounts)} for b in desk],
        "updated_at": min(stamps) if stamps else None, "latest_at": max(stamps) if stamps else None,
        "fetched": list(fetched.values()),
        "statuses": [{"key": k, "label": l} for k, l in STATUSES],
        "totals": {**totals, "open": sum(totals[k] for k in OPEN), "quantity_open": qty_open, **sla},
        "due": due,
        "days": [{**d, "by_business": [{"business": k, "count": n} for k, n in sorted(d["by_business"].items())]}
                 for d in sorted(days.values(), key=lambda d: d["date"], reverse=True)],
        "by_business": sorted(by_business.values(), key=lambda b: b["business"]),
        "by_courier": sorted(by_courier.values(), key=lambda c: -(c[S_DOWNLOAD] + c[S_DOWNLOADED])),
        "skus": sorted(skus.values(), key=lambda k: -k["quantity"])[:50],
        "automation": {"enabled": setting.enabled, "accept_every_minutes": setting.accept_every_minutes,
                       "label_times": setting.label_times or [], "next_accept_at": nxt_accept, "next_labels_at": nxt_labels,
                       "last_accept_at": setting.last_accept_at, "last_labels_at": setting.last_labels_at},
        "orders": (open_rows + done_rows)[:ROWS_MAX],
    })
