"""
Write one account's returns, as the sync worker last read them from Meesho
(MeeshoReturnsJob), into the returns table — meesho_returns.sync_account.
Prints one line of JSON with the counts per return status.
"""

import json

from django.core.management.base import BaseCommand, CommandError

from meesho_app.meesho_returns import sync_account
from meesho_app.models import MeeshoAccount


class Command(BaseCommand):
    help = "Write a Meesho account's last-read returns into the returns table."

    def add_arguments(self, parser):
        parser.add_argument("--account", type=int, required=True)

    def handle(self, *args, account, **opts):
        a = MeeshoAccount.objects.select_related("business").filter(pk=account).first()
        if not a:
            raise CommandError(f"No Meesho account {account}.")
        self.stdout.write(json.dumps(sync_account(a), default=str))
