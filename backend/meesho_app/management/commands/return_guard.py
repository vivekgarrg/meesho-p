"""
Run the Return Guard: pause products whose returns are over the limit or that
sell at a loss, and alert (see meesho_app/return_guard.py for the rules).

  manage.py return_guard              pause what breaks a rule
  manage.py return_guard --dry-run    only say what it would pause

Run daily by the sync worker (ReturnGuardJob) — it pauses only while auto-pause is
switched on (MeeshoAutoSetting.return_guard_auto, off by default). Prints one JSON line.
"""

import json

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Pause products with returns over the limit or selling at a loss, and alert."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Say what would be paused; change nothing.")
        parser.add_argument("--business", type=int, action="append", help="Only this business id (repeatable).")
        parser.add_argument("--force", action="store_true", help="Pause even when auto-pause is switched off.")

    def handle(self, *args, **opts):
        from meesho_app import return_guard
        from meesho_app.models import MeeshoAutoSetting
        if not opts["dry_run"] and not opts["force"] and not MeeshoAutoSetting.get().return_guard_auto:
            # Auto-pause is off (Return Analysis → the Auto-pause switch): pause nothing.
            self.stdout.write(json.dumps({"paused": [], "skipped": "auto-pause is off", **return_guard.rules()}))
            return
        done = return_guard.run(business_ids=opts["business"], dry_run=opts["dry_run"])
        self.stdout.write(json.dumps({"paused": done, "dry_run": opts["dry_run"], **return_guard.rules()}))
