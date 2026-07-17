import os

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = (
        "One-time load of the seed data fixture into an empty database. "
        "Safe to run on every deploy: it loads only when the database has "
        "no order data AND no sentinel marker exists on disk, so data "
        "edited in production is never overwritten on subsequent deploys."
    )

    FIXTURE = os.path.join(settings.BASE_DIR, "fixtures", "proddata.json.gz")

    def _marker_path(self):
        # Live next to the database file so the marker lives on the same
        # (persistent) disk as the data it guards.
        db_name = settings.DATABASES["default"].get("NAME")
        base_dir = os.path.dirname(str(db_name)) if db_name else str(settings.BASE_DIR)
        return os.path.join(base_dir, ".initial_data_loaded")

    def _orders_exist(self):
        # Data-driven guard independent of the marker file: if the orders
        # table already has rows, treat the DB as already populated.
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1 FROM orders LIMIT 1")
                return cursor.fetchone() is not None
        except Exception:
            # Table missing (pre-migrate) or unreadable -> treat as empty.
            return False

    def handle(self, *args, **options):
        marker = self._marker_path()

        if os.path.exists(marker):
            self.stdout.write("Initial data already loaded (marker present); skipping.")
            return

        if self._orders_exist():
            self.stdout.write("Database already contains order data; skipping load.")
            self._write_marker(marker)
            return

        if not os.path.exists(self.FIXTURE):
            self.stderr.write(self.style.WARNING(f"Fixture not found at {self.FIXTURE}; nothing to load."))
            return

        self.stdout.write(f"Loading initial data from {self.FIXTURE} ...")
        # If loaddata raises, the marker is NOT written, so the next deploy
        # retries and the failure surfaces in the deploy logs.
        call_command("loaddata", self.FIXTURE)
        self._write_marker(marker)
        self.stdout.write(self.style.SUCCESS("Initial data loaded."))

    def _write_marker(self, marker):
        try:
            with open(marker, "w") as fh:
                fh.write("loaded\n")
        except OSError as exc:
            # Non-fatal: the orders-exist guard still prevents a re-load.
            self.stderr.write(self.style.WARNING(f"Could not write marker {marker}: {exc}"))
