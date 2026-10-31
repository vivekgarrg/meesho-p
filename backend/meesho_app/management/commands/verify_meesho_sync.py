"""
Check the Meesho sync end to end: what the worker last read from Meesho (its
snapshots and runs) against what the middleware put in the app's tables.

  orders    every order the panel lists is in the orders table, its current
            status the panel's or one further on (never behind)
  returns   every return Meesho lists is in the returns table, in its stage
            (a delivered one may already be delivered; never the other way)
  payments  no unpaid (future, no bank transfer) row in the paid table; the
            outstanding table holds what the last read found; every payout day
            Meesho shows in the synced window matches the order payments on
            file for that date
  stock     Meesho Stock lists the SKUs live on Meesho

  python manage.py verify_meesho_sync [--account ID] [--json]

Exits 1 when anything doesn't match, listing samples of what and why.
"""

import json
import sys
from datetime import timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db.models import Q, Sum

from meesho_app.models import (MeeshoAccount, MeeshoInventory, MeeshoListing, MeeshoOutstandingPayment, MeeshoSyncRun,
                               MeeshoSyncSnapshot, Order, OrderPayment, ReturnDelivery)
from meesho_app.sync_middleware import orders as orders_mw
from meesho_app.sync_middleware.returns import SNAPSHOT, STATUSES, normalize
from meesho_app.views import _ist_today

SAMPLES = 5
RETURN_STAGE = {"in_transit": {"IN_TRANSIT", "DELIVERED", "LOST", "DISPOSED"}, "delivered": {"DELIVERED"},
                "lost": {"LOST", "DELIVERED"}, "disposed": {"DISPOSED", "DELIVERED"}}


class Check:
    def __init__(self, name):
        self.name, self.checked, self.problems, self.samples, self.notes = name, 0, 0, [], []

    def bad(self, what):
        self.problems += 1
        if len(self.samples) < SAMPLES:
            self.samples.append(what)

    def as_dict(self):
        return {"checked": self.checked, "problems": self.problems, "samples": self.samples, "notes": self.notes}


def check_orders(a):
    c = Check("orders")
    rows = {r["sub_order_num"]: r for r in orders_mw.rows_of(a) if r.get("sub_order_num") and r.get("tab") in orders_mw.STATUS}
    latest = {}
    subs = list(rows)
    for i in range(0, len(subs), 500):
        base = Order.objects.filter(business=a.business, sub_order_no__in=subs[i:i + 500])
        for o in Order.latest_per_order(base):
            latest[o.sub_order_no] = o.reason_for_credit_entry
    for sub, r in rows.items():
        c.checked += 1
        want = orders_mw.STATUS[r["tab"]]
        have = latest.get(sub)
        if have is None:
            c.bad({"sub_order": sub, "panel": want, "table": None, "why": "not in the orders table"})
        elif have != want and orders_mw.moves_on(have, want):
            c.bad({"sub_order": sub, "panel": want, "table": have, "why": "the table is behind the panel"})
    return c


def check_returns(a):
    c = Check("returns")
    snaps = {s.endpoint: s for s in MeeshoSyncSnapshot.objects.filter(account=a, endpoint__startswith="returns_")}
    have = {(r.suborder_no, r.awb_number): r.stage for r in ReturnDelivery.objects.filter(business=a.business)}
    for meesho_status, kind, _ in STATUSES:
        snap = snaps.get(SNAPSHOT.format(meesho_status))
        for raw in (snap.payload if snap and isinstance(snap.payload, list) else []):
            row = normalize(raw, meesho_status)
            if not row.get("suborder_no"):
                continue
            c.checked += 1
            stage = have.get((row["suborder_no"], row.get("awb_number") or ""))
            if stage is None:
                c.bad({"sub_order": row["suborder_no"], "awb": row.get("awb_number"), "meesho": meesho_status, "why": "not in the returns table"})
            elif stage not in RETURN_STAGE[kind]:
                c.bad({"sub_order": row["suborder_no"], "meesho": meesho_status, "table": stage, "why": "in the wrong stage"})
    return c


def check_payments(a):
    c = Check("payments")
    unpaid = (OrderPayment.objects.filter(business=a.business, payment_date__gt=_ist_today())
              .filter(Q(transaction_id__isnull=True) | Q(transaction_id__in=["", "nan", "None", "-"])))
    c.checked += 1
    if unpaid.exists():
        c.bad({"why": f"{unpaid.count()} unpaid rows in the paid table — run remove_unpaid_order_payments",
               "sample": list(unpaid.values_list("sub_order_no", flat=True)[:3])})
    run = MeeshoSyncRun.objects.filter(account=a, kind="PAYMENTS", status="OK").order_by("-finished_at").first()
    outstanding = MeeshoOutstandingPayment.objects.filter(business=a.business).count()
    if run and run.result:
        o = (run.result.get("files") or {}).get("outstanding") or {}
        c.checked += 1
        if not o.get("note") and not o.get("error") and o.get("rows") is not None and int(o["rows"]) != outstanding:
            c.bad({"why": f"the last read found {o['rows']} outstanding, the table holds {outstanding}"})
        done = (run.result.get("files") or {}).get("completed") or {}
        if done.get("from") and done.get("to"):
            on_file = (OrderPayment.objects.filter(business=a.business, payment_date__gte=done["from"], payment_date__lte=done["to"])
                       .aggregate(t=Sum("final_settlement_amount"))["t"] or Decimal(0))
            snap = MeeshoSyncSnapshot.objects.filter(account=a, endpoint="payments_summary").first()
            meesho = ((snap.payload or {}).get("previous_total") or {}).get("netAmount") if snap and isinstance(snap.payload, dict) else None
            c.notes.append(f"order payments on file {done['from']}…{done['to']}: ₹{on_file:,.2f}"
                           + (f"; Meesho's paid total over its last payouts (orders less ads and recoveries): ₹{Decimal(str(meesho)):,.2f}"
                              if meesho is not None else ""))
            # Day by day: each payout Meesho shows in the window, against the
            # order payments on file for that date.
            days = ((snap.payload or {}).get("previous") or {}).get("daywisePayments") or [] if snap and isinstance(snap.payload, dict) else []
            for day in days:
                if not (done["from"] <= str(day.get("date")) <= done["to"]) or day.get("netOrderAmount") is None:
                    continue
                c.checked += 1
                ours = (OrderPayment.objects.filter(business=a.business, payment_date=day["date"])
                        .aggregate(t=Sum("final_settlement_amount"))["t"] or Decimal(0))
                gap = Decimal(str(ours)) - Decimal(str(day["netOrderAmount"]))
                if abs(gap) > 1:
                    c.bad({"payout": day["date"], "meesho": day["netOrderAmount"], "on_file": float(ours), "gap": float(gap),
                           "why": "on file more than Meesho paid — run remove_unpaid_order_payments" if gap > 0
                           else "on file less than Meesho paid — payments not imported"})
    else:
        c.notes.append("no payments read yet")
    return c


def check_stock(a):
    c = Check("stock")
    live = MeeshoListing.objects.filter(account=a, archived=False)
    sheet = {(r.product_id, r.variation_id) for r in MeeshoInventory.objects.filter(business=a.business)}
    for pid, vid in live.values_list("product_id", "variation_id"):
        c.checked += 1
        if (pid, vid) not in sheet:
            c.bad({"product_id": pid, "variation_id": vid, "why": "live on Meesho, missing from Meesho Stock"})
    return c


class Command(BaseCommand):
    help = "Check that the Meesho sync's middleware put what Meesho said into the app's tables."

    def add_arguments(self, parser):
        parser.add_argument("--account", type=int)
        parser.add_argument("--json", action="store_true")

    def handle(self, *args, account=None, json=False, **opts):
        accounts = MeeshoAccount.objects.select_related("business").exclude(status=MeeshoAccount.STATUS_DISABLED)
        if account:
            accounts = accounts.filter(pk=account)
        report, problems = {}, 0
        for a in accounts:
            checks = [check_orders(a), check_returns(a), check_payments(a), check_stock(a)]
            report[a.business.name] = {c.name: c.as_dict() for c in checks}
            problems += sum(c.problems for c in checks)
        if json:
            self.stdout.write(_json(report))
        else:
            for name, checks in report.items():
                self.stdout.write(f"\n{name}")
                for kind, c in checks.items():
                    mark = "OK " if not c["problems"] else "BAD"
                    self.stdout.write(f"  {mark} {kind:9} {c['checked']:>6} checked, {c['problems']} problem(s)")
                    for s in c["samples"]:
                        self.stdout.write(f"        · {s}")
                    for n in c["notes"]:
                        self.stdout.write(f"        ({n})")
        if problems:
            sys.exit(1)


def _json(x):
    return json.dumps(x, default=str, indent=2)
