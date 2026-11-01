"""
Make a label batch whole again: the businesses whose labels failed (Meesho
busy, refused…) are labelled again, then every business's labels in the
batch are merged into one PDF sorted by parent SKU, kept for Latest labels and
Order Scan, and — with --send — sent to Telegram / email / WhatsApp.

  python manage.py meesho_redo_labels --latest --send       # the newest batch
  python manage.py meesho_redo_labels --batch auto-20261101-1700-ab12cd --send
  python manage.py meesho_redo_labels --list                # the recent batches

The work is done by the sync worker (MeeshoRedoLabelsJob); this queues it.
"""

from django.core.management.base import BaseCommand, CommandError

from meesho_app import meesho_sync, notify
from meesho_app.models import MeeshoAccount, MeeshoSyncRun


class Command(BaseCommand):
    help = "Label again the businesses that failed in a label batch, then merge, sort, keep and (with --send) send it."

    def add_arguments(self, parser):
        parser.add_argument("--batch")
        parser.add_argument("--latest", action="store_true")
        parser.add_argument("--list", action="store_true")
        parser.add_argument("--send", action="store_true")

    def handle(self, *args, batch=None, latest=False, list=False, send=False, **opts):
        batches = meesho_sync._label_batches(MeeshoAccount.objects.all())
        if list or not (batch or latest):
            for b in batches:
                states = ", ".join(f"{r['business_name']}: {'ready' if r['ready'] else r['status']}" for r in b["runs"])
                self.stdout.write(f"{b['batch']}  {b['queued_at']:%d %b %H:%M}  {states}")
            if not (batch or latest):
                self.stdout.write("Pick one with --batch, or --latest.")
            return
        if latest:
            if not batches:
                raise CommandError("No label batches yet.")
            batch = batches[0]["batch"]
        if not MeeshoSyncRun.objects.filter(kind=meesho_sync.KIND_LABELS, result__batch=batch).exists():
            raise CommandError(f"No label batch {batch}.")
        if send and not notify.channels():
            raise CommandError("No channel is set up to send on — add TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID to the .env.")
        meesho_sync.enqueue("MeeshoRedoLabelsJob", [batch, send])
        self.stdout.write(f"Queued: label {batch} again where it failed, merge, sort{', send' if send else ''}. "
                          f"The worker does it now — watch Meesho → Ready to ship, or Telegram.")
