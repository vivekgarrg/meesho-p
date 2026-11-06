"""
Run the Return Guard: pause products whose returns are over the limit or that
sell at a loss, and alert (see meesho_app/return_guard.py for the rules).

  manage.py return_guard              pause what breaks a rule
  manage.py return_guard --dry-run    only say what it would pause

Run daily by the sync worker (ReturnGuardJob). Prints one JSON line.
"""

import json

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Pause products with returns over the limit or selling at a loss, and alert."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Say what would be paused; change nothing.")
        parser.add_argument("--business", type=int, action="append", help="Only this business id (repeatable).")

    def handle(self, *args, **opts):
        from meesho_app import return_guard
        done = return_guard.run(business_ids=opts["business"], dry_run=opts["dry_run"])
        self.stdout.write(json.dumps({"paused": done, "dry_run": opts["dry_run"], **return_guard.rules()}))
