"""Housekeeping drops old sync history, but never the latest run screens read."""

import io
import json
import os
import tempfile
from unittest import mock

from django.core.cache.backends.filebased import FileBasedCache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from accounts.models import Business

from .management.commands import housekeeping
from .models import MeeshoAccount, MeeshoSyncRun as R


class HousekeepingTests(TestCase):
    def setUp(self):
        biz = Business.objects.create(name="Rudam")
        self.acc = MeeshoAccount.objects.create(business=biz, phone_number="9000000001", password_enc="x", status="ACTIVE",
                                                supplier_id="1", supplier_identifier="x")

    def run_(self, kind, status, days_ago):
        r = R.objects.create(account=self.acc, kind=kind, status=status)
        R.objects.filter(pk=r.pk).update(queued_at=timezone.now() - timezone.timedelta(days=days_ago))
        return r.pk

    def test_old_runs_go_but_the_latest_of_each_kind_stays(self):
        old_ok = self.run_("PAYMENTS", R.STATUS_OK, 60)          # the last successful payments pull — kept
        old_fail = self.run_("PAYMENTS", R.STATUS_FAILED, 50)    # the last payments run of all — kept
        gone = [self.run_("SYNC", R.STATUS_OK, 40 + i) for i in range(3)]
        recent = self.run_("SYNC", R.STATUS_OK, 1)
        out = io.StringIO()
        with mock.patch("meesho_app.meesho_return_claim._sweep_uploads") as sweep:
            call_command("housekeeping", stdout=out)
        self.assertEqual(json.loads(out.getvalue())["runs_deleted"], 3)
        self.assertEqual(set(R.objects.values_list("pk", flat=True)), {old_ok, old_fail, recent})
        self.assertFalse(R.objects.filter(pk__in=gone).exists())
        sweep.assert_called_once()

    def test_expired_cache_files_are_removed(self):
        import time
        with tempfile.TemporaryDirectory() as d:
            cache = FileBasedCache(d, {})
            cache.set("fresh", "x", 600)
            cache.set("stale", "y", 5)
            stale_file = cache._key_to_file("stale")
            later = time.time() + 60
            with mock.patch.object(housekeeping, "caches", {"api": cache}), \
                    mock.patch("django.core.cache.backends.filebased.time.time", return_value=later):
                files, _ = housekeeping.prune_api_cache()
                self.assertEqual((files, os.path.exists(stale_file), cache.get("fresh")), (1, False, "x"))
                housekeeping.prune_api_cache(clear=True)
                self.assertEqual(cache._list_cache_files(), [])
