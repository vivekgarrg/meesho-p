"""
Raise one queued return claim on Meesho — run by the Sidekiq worker
(MeeshoClaimJob), so nobody waits on the page while a video is compressed and
every file goes up. Prints one line of JSON: {"next": "done" | "wait" | "retry"
| "failed", "in": seconds} — what the job does next.
"""

import json

from django.core.management.base import BaseCommand

from meesho_app import meesho_return_claim as rc


class Command(BaseCommand):
    help = "Raise one queued Meesho return claim (files, POD, ticket)."

    def add_arguments(self, parser):
        parser.add_argument("--claim", type=int, required=True)
        parser.add_argument("--attempt", type=int, default=1)
        parser.add_argument("--give-up", default="", help="Mark it failed for good, with this reason.")

    def handle(self, *args, claim, attempt, give_up, **opts):
        if give_up:
            rc.give_up(claim, give_up)
            self.stdout.write(json.dumps({"next": "failed"}))
            return
        self.stdout.write(json.dumps(rc.process_claim(claim, attempt)))
