"""
Read every payment Flipkart Seller Hub still lists for a business (or every
connected one) — each transfer, the order items it paid and its other charges —
into the Flipkart tables at once, rather than PAYOUT_READS transfers per sync
run. For a first load of the history; the 30-minute sync keeps it up to date.
Prints one line of JSON: {business_id: what was written | "error: …"}.
"""

import json

from django.core.management.base import BaseCommand

from meesho_app import flipkart_seller, flipkart_sync
from meesho_app.models import FlipkartSellerAccount as A


class Command(BaseCommand):
    help = "Read every Flipkart Seller Hub payment into the Flipkart tables (the whole history at once)."

    def add_arguments(self, parser):
        parser.add_argument("--business", type=int, help="One business (default: every connected one)")

    def handle(self, *args, business=None, **opts):
        out = {}
        qs = A.objects.filter(status=A.STATUS_ACTIVE).select_related("business")
        for a in qs.filter(business_id=business) if business else qs:
            try:
                out[a.business_id] = flipkart_sync.run(a, reads=None)
            except flipkart_seller.FlipkartError as e:
                out[a.business_id] = f"error: {e}"
        self.stdout.write(json.dumps({str(k): v for k, v in out.items()}, default=str))
