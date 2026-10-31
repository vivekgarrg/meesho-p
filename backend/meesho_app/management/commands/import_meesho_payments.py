"""
Import Meesho payment files the sync worker downloaded (MeeshoPaymentsJob) —
through the payments middleware (sync_middleware/payments.py):

  --kind completed    → the payments tables, as the Payments upload does
  --kind outstanding  → the outstanding payments (repeat --file, one per day)

Prints one line of JSON: what was written, and any rows refused with why.
"""

import json

from django.core.management.base import BaseCommand, CommandError

from accounts.models import Business
from meesho_app.sync_middleware import payments


class Command(BaseCommand):
    help = "Import a Meesho payment file (.zip or .xlsx) downloaded by the sync worker."

    def add_arguments(self, parser):
        parser.add_argument("--business", type=int, required=True)
        parser.add_argument("--file", action="append", required=True,
                            help="Repeat for several files (outstanding: one per day, imported together).")
        parser.add_argument("--kind", choices=["completed", "outstanding"], required=True)

    def handle(self, *args, business, file, kind, **opts):
        biz = Business.objects.filter(pk=business).first()
        if not biz:
            raise CommandError(f"No business {business}.")
        paths = [file] if isinstance(file, str) else list(file)    # call_command passes one file as a string
        try:
            books = [payments.open_workbook(p) for p in paths]
        except Exception as exc:
            raise CommandError(f"Could not read the payment file: {exc}")
        res = payments.import_completed(biz, books) if kind == "completed" else payments.import_outstanding(biz, books)
        self.stdout.write(json.dumps(res.as_dict(), default=str))
