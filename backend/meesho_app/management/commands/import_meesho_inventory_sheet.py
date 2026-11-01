"""
Import Meesho's own inventory sheet (downloaded by the sync worker,
MeeshoInventoryJob) into Meesho Stock — every SKU of the business (active,
paused, blocked…) with Meesho's catalog / product / variation ids, matched by
product + variation as the Meesho Stock upload does.

  python manage.py import_meesho_inventory_sheet --business ID --file PATH

Prints one line of JSON: created, updated, skipped, and the (product,
variation) pairs the sheet lists (the worker keeps them, so its listing
mirror never removes a row Meesho's sheet still has).
"""

import json

from django.core.management.base import BaseCommand, CommandError

from accounts.models import Business
from meesho_app.views import InventorySheetError, import_meesho_inventory_sheet


class Command(BaseCommand):
    help = "Import Meesho's inventory sheet into Meesho Stock."

    def add_arguments(self, parser):
        parser.add_argument("--business", type=int, required=True)
        parser.add_argument("--file", required=True)

    def handle(self, *args, business, file, **opts):
        biz = Business.objects.filter(pk=business).first()
        if not biz:
            raise CommandError(f"No business {business}.")
        try:
            with open(file, "rb") as fh:
                res = import_meesho_inventory_sheet(biz, fh)
        except InventorySheetError as exc:
            raise CommandError(str(exc))
        self.stdout.write(json.dumps(res))
