"""
Read every connected Flipkart Seller Hub account's dashboard — which also keeps
its session alive. Run by the sync's schedule (sync/app/jobs/flipkart_refresh_job.rb).
Prints one line of JSON: {business_id: "ok" | "expired" | "error: …"}.
"""

import json

from django.core.management.base import BaseCommand

from meesho_app.flipkart_seller import refresh_all


class Command(BaseCommand):
    help = "Refresh every connected Flipkart Seller Hub account (keeps the sessions alive)."

    def handle(self, *args, **opts):
        self.stdout.write(json.dumps({str(k): v for k, v in refresh_all().items()}))
