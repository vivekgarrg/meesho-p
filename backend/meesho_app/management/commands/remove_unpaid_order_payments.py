"""
Remove order payments that were never paid: rows with no bank transaction id
and a payment date still to come — what an outstanding-payments sheet put into
OrderPayment when it was uploaded on the Payments page (the upload now skips
them). They make orders look settled (Unsettled, profit) when no money has
landed. Shows what it would remove; --apply removes it.

  python manage.py remove_unpaid_order_payments [--business ID] [--apply]
"""

from django.core.management.base import BaseCommand
from django.db.models import Count, Q

from meesho_app.models import OrderPayment
from meesho_app.views import _ist_today


class Command(BaseCommand):
    help = "Remove never-paid (outstanding) rows from the order payments table."

    def add_arguments(self, parser):
        parser.add_argument("--business", type=int)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, business=None, apply=False, **opts):
        qs = (OrderPayment.objects.filter(payment_date__gt=_ist_today())
              .filter(Q(transaction_id__isnull=True) | Q(transaction_id__in=["", "nan", "None", "-"])))
        if business:
            qs = qs.filter(business_id=business)
        for r in qs.values("business__name").annotate(n=Count("id")).order_by("business__name"):
            self.stdout.write(f"{r['business__name']}: {r['n']} unpaid rows")
        total = qs.count()
        if not apply:
            self.stdout.write(f"{total} rows would be removed — run again with --apply to remove them.")
            return
        qs.delete()
        self.stdout.write(f"Removed {total} rows.")
