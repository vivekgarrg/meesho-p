"""
Clean the order payments table of rows that make money look paid twice or
early — what uploaded outstanding-payment sheets and re-read files left behind
(the importer now prevents all three):

  future      no bank transfer and a payment date still to come — expected,
              not paid
  superseded  no bank transfer, for an order Meesho has since actually paid, or
              on a date whose payout was made (its rows carry a transfer) —
              the expectation was replaced by what was paid
  status      the same payment (order, date, transfer, amount) stored again only
              because the order's live status had moved on — the newest is kept

Rows with no bank transfer on a date with no transfer at all are listed, never
removed: they may be genuine payments from an older export.

  python manage.py remove_unpaid_order_payments [--business ID] [--apply]

Shows what it would remove; --apply removes it (and the cached screens —
profit… — are recomputed).
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Count, Q, Sum

from meesho_app.models import OrderPayment
from meesho_app.sync_middleware.base import deferred_bumps
from meesho_app.views import _NO_TXN, _ist_today

NO_TXN = Q(transaction_id__isnull=True) | Q(transaction_id__in=_NO_TXN)


class Command(BaseCommand):
    help = "Remove order payments that count money as paid twice or before it was paid."

    def add_arguments(self, parser):
        parser.add_argument("--business", type=int)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, business=None, apply=False, **opts):
        base = OrderPayment.objects.all()
        if business:
            base = base.filter(business_id=business)

        future = base.filter(NO_TXN, payment_date__gt=_ist_today())
        # Superseded: the order has since been paid, or that business's payout
        # for that date was made (its rows carry a transfer) — sub-order
        # numbers and payouts are per business.
        paid_keys = set(base.exclude(NO_TXN).values_list("business_id", "sub_order_no"))
        paid_days = set(base.exclude(NO_TXN).values_list("business_id", "payment_date"))
        candidates = base.filter(NO_TXN).exclude(pk__in=future.values("pk")).values_list("pk", "business_id", "sub_order_no", "payment_date")
        superseded = base.filter(pk__in=[pk for pk, biz, sub, day in candidates if (biz, sub) in paid_keys or (biz, day) in paid_days])

        dupes = (base.exclude(NO_TXN).values("business_id", "sub_order_no", "payment_date", "transaction_id", "final_settlement_amount")
                 .annotate(n=Count("id"), statuses=Count("live_order_status", distinct=True)).filter(n__gt=1, statuses__gt=1))
        status_ids = []
        for d in dupes:
            rows = list(base.filter(business_id=d["business_id"], sub_order_no=d["sub_order_no"], payment_date=d["payment_date"],
                                    transaction_id=d["transaction_id"], final_settlement_amount=d["final_settlement_amount"])
                        .order_by("-uploaded_at", "-id").values_list("pk", flat=True))
            status_ids += rows[1:]                                    # keep the newest
        status = base.filter(pk__in=status_ids)

        unknown = base.filter(NO_TXN).exclude(pk__in=future.values("pk")).exclude(pk__in=superseded.values("pk"))
        groups = {"future": future, "superseded": superseded, "status": status}
        for name, qs in groups.items():
            total = qs.aggregate(t=Sum("final_settlement_amount"))["t"] or 0
            self.stdout.write(f"{name:10} {qs.count():>6} rows   ₹{total:,.2f}")
            for r in qs.values("business__name").annotate(n=Count("id")).order_by("business__name"):
                self.stdout.write(f"             {r['business__name']}: {r['n']}")
        self.stdout.write(f"kept       {unknown.count():>6} rows with no bank transfer and no paid row for the order (listed, not removed)")

        removing = sum(qs.count() for qs in groups.values())
        if not apply:
            self.stdout.write(f"{removing} rows would be removed — run again with --apply to remove them.")
            return
        ids = set()
        for qs in groups.values():
            ids.update(qs.values_list("pk", flat=True))         # resolved before deleting from the same table
        with deferred_bumps(), transaction.atomic():
            OrderPayment.objects.filter(pk__in=ids).delete()     # per-row signals: each business's cache is invalidated once
        self.stdout.write(f"Removed {len(ids)} rows.")
