"""
Flipkart's automation (meesho_app.flipkart_auto). Run by the sync's schedule
every minute (sync/app/jobs/flipkart_auto_job.rb) as `--run due`: accept every
N minutes, and at each label time accept, print, keep, send and mark RTD — as
set under Business Settings → Flipkart setup. By hand: `--run labels` or
`--run accept`, for one business (--business), at most --limit shipments.

Prints one line of JSON: what was done.
"""

import json

from django.core.management.base import BaseCommand

from meesho_app import flipkart_auto


class Command(BaseCommand):
    help = "Flipkart automation: accept, print labels, keep them, send them, mark RTD."

    def add_arguments(self, parser):
        parser.add_argument("--run", choices=["due", "labels", "accept"], default="due")
        parser.add_argument("--business", type=int)
        parser.add_argument("--limit", type=int, help="At most this many shipments (1: the one-order test).")
        parser.add_argument("--no-send", action="store_true")
        parser.add_argument("--no-rtd", action="store_true")

    def handle(self, *args, run, business, limit, no_send, no_rtd, **opts):
        if run == "due":
            out = flipkart_auto.run_due()
        else:
            out = flipkart_auto.run(run, business_id=business, trigger="MANUAL", limit=limit,
                                    send=False if no_send else None, rtd=False if no_rtd else None)
        self.stdout.write(json.dumps(out, default=str))
