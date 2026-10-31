"""
Write one Meesho account's last-read data (the sync worker's snapshots) into
the app's tables, through that data's middleware (sync_middleware/):

  --kind orders   → Order           (sync_middleware/orders.py)
  --kind returns  → ReturnDelivery  (sync_middleware/returns.py)

Payments come as files: import_meesho_payments. Prints one line of JSON — what
was written, and any rows refused with why — which the worker keeps on its run.
"""

import json

from django.core.management.base import BaseCommand, CommandError

from meesho_app.models import MeeshoAccount
from meesho_app.sync_middleware import orders, returns


class Command(BaseCommand):
    help = "Write a Meesho account's last-read orders or returns into the app's tables."

    def add_arguments(self, parser):
        parser.add_argument("--account", type=int, required=True)
        parser.add_argument("--kind", choices=["orders", "returns"], required=True)

    def handle(self, *args, account, kind, **opts):
        a = MeeshoAccount.objects.select_related("business").filter(pk=account).first()
        if not a:
            raise CommandError(f"No Meesho account {account}.")
        res = orders.inject(a.business, orders.rows_of(a)) if kind == "orders" else returns.inject(a)
        self.stdout.write(json.dumps(res.as_dict(), default=str))
