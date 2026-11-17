"""
Move one Flipkart shop's records to the business they belong to.

Why: a Flipkart shop's name isn't the business's — Cosmify Mart's shop on Flipkart
is called "Rudam" — so its Orders / Settlement reports were uploaded under the
business "Rudam". The sync then sees those payments "already recorded under
Rudam" and refuses Cosmify Mart's own login (flipkart_sync.elsewhere).

What moves from --from to --to: what the --from business's own Seller Hub login
never read — its records came from uploaded reports only:
  orders            never synced by the login (synced_at empty), and not paid by a
                    transfer the login read
  payments          on a transfer (UTR) the login never read
  other charges     on those transfers
  outstanding       of the orders that move
Payouts (only ever read by a login) stay. Nothing is deleted. Without --apply it
only says what it would move.

    manage.py flipkart_move_shop --from Rudam --to "Cosmify Mart"            # preview
    manage.py flipkart_move_shop --from Rudam --to "Cosmify Mart" --apply
"""

import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Business
from meesho_app.models import (FlipkartOrder, FlipkartOrderPayment, FlipkartOtherCharge, FlipkartOutstandingPayment,
                               FlipkartPayout)


def plan(src, dst):
    """The querysets that would move from src to dst."""
    synced_payments = FlipkartOrderPayment.objects.filter(business=src, source="seller_hub")
    login_utrs = (set(synced_payments.values_list("neft_id", flat=True))
                  | set(FlipkartPayout.objects.filter(business=src).values_list("utr", flat=True))) - {""}
    login_items = set(synced_payments.values_list("order_item_id", flat=True))
    payments = FlipkartOrderPayment.objects.filter(business=src).exclude(source="seller_hub").exclude(neft_id__in=login_utrs)
    moving_utrs = set(payments.values_list("neft_id", flat=True)) - {""}
    orders = FlipkartOrder.objects.filter(business=src, synced_at__isnull=True).exclude(order_item_id__in=login_items)
    items = set(orders.values_list("order_item_id", flat=True))
    charges = FlipkartOtherCharge.objects.filter(business=src, neft_id__in=moving_utrs)
    outstanding = FlipkartOutstandingPayment.objects.filter(business=src, order_item_id__in=items)
    # Already there under the destination (same order item / payment row): left where they are, said so.
    clash = {
        "orders": FlipkartOrder.objects.filter(business=dst, order_item_id__in=items).count(),
        "payments": FlipkartOrderPayment.objects.filter(business=dst, neft_id__in=moving_utrs).count(),
    }
    return {"orders": orders, "payments": payments, "other_charges": charges, "outstanding": outstanding}, clash, moving_utrs


class Command(BaseCommand):
    help = "Move a Flipkart shop's uploaded records to the business it belongs to (preview unless --apply)."

    def add_arguments(self, parser):
        parser.add_argument("--from", dest="src", required=True, help="The business they're under now (name or id).")
        parser.add_argument("--to", dest="dst", required=True, help="The business they belong to (name or id).")
        parser.add_argument("--apply", action="store_true", help="Move them. Without it, only say what would move.")

    def _business(self, v):
        if str(v).isdigit():
            b = Business.objects.filter(pk=int(v)).first()
            if not b:
                raise CommandError(f"No business with id {v}.")
            return b
        found = list(Business.objects.filter(name__iexact=str(v).strip()))
        if not found:
            raise CommandError(f"No business {v!r}.")
        if len(found) > 1:
            raise CommandError(f"{len(found)} businesses are called {v!r} — give the id instead: "
                               + ", ".join(f"{b.pk}" for b in found))
        return found[0]

    def handle(self, *args, src, dst, apply, **opts):
        src, dst = self._business(src), self._business(dst)
        if src == dst:
            raise CommandError("--from and --to are the same business.")
        qs, clash, utrs = plan(src, dst)
        if any(clash.values()):
            raise CommandError(f"{dst.name} already has some of these records ({clash}) — nothing moved; look at them first.")
        counts = {k: q.count() for k, q in qs.items()}
        out = {"from": src.name, "to": dst.name, "would_move" if not apply else "moved": counts, "transfers": len(utrs),
               "orders_dates": [str(d) for d in (qs["orders"].order_by("order_date").values_list("order_date", flat=True).first(),
                                                 qs["orders"].order_by("-order_date").values_list("order_date", flat=True).first())]}
        if apply:
            from meesho_app.api_cache import bump
            with transaction.atomic():
                for q in qs.values():
                    q.update(business=dst)
            bump(src.pk)                     # both businesses' cached pages are read again
            bump(dst.pk)
        self.stdout.write(json.dumps(out, default=str))
