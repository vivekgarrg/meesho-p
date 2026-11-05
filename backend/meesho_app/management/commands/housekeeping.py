"""
Keep the server's disk in bounds — run daily by the sync worker (HousekeepingJob)
and on every deploy. Safe to run any time; it only drops what nothing reads:

  * sync-run history (MeeshoSyncRun) older than RUN_DAYS — the newest run, and
    the newest successful run, of each account and kind always stay (screens
    read "last pulled" from them);
  * API cache files that have expired (the file cache only removes them when
    it is over its entry limit, so expired answers otherwise sit on disk);
  * claim uploads left over from claims that never finished (see
    meesho_return_claim._sweep_uploads).

Prints one JSON line: what it removed.
"""

import json
import os

from django.core.cache import caches
from django.core.management.base import BaseCommand
from django.db.models import Max
from django.utils import timezone

RUN_DAYS = 30


def prune_runs(days=RUN_DAYS):
    from meesho_app.models import MeeshoSyncRun as R
    cutoff = timezone.now() - timezone.timedelta(days=days)
    keep = set()
    for flt in ({}, {"status": R.STATUS_OK}):
        keep |= {row["last"] for row in R.objects.filter(**flt).values("account_id", "kind").annotate(last=Max("id"))}
    old = R.objects.filter(queued_at__lt=cutoff).exclude(id__in=keep)
    n = 0
    # In slices: one huge DELETE holds locks and swells the undo log.
    while True:
        ids = list(old.values_list("id", flat=True)[:2000])
        if not ids:
            return n
        n += R.objects.filter(id__in=ids).delete()[0]


def prune_api_cache(clear=False):
    """Expired API-cache files removed (or every one, with clear=True — a deploy
    starts the cache afresh anyway). Returns (files removed, bytes freed)."""
    cache = caches["api"]
    lister = getattr(cache, "_list_cache_files", None)
    if not lister:
        return 0, 0                                   # not the file cache (tests, another backend)
    files = freed = 0
    for path in lister():
        try:
            size = os.path.getsize(path)
            if clear:
                os.remove(path)
                gone = True
            else:
                with open(path, "rb") as fh:
                    gone = cache._is_expired(fh)      # deletes the file when it has expired
            if gone:
                files += 1
                freed += size
        except OSError:
            continue
    return files, freed


class Command(BaseCommand):
    help = "Drop old sync history, expired cache files and abandoned claim uploads."

    def add_arguments(self, parser):
        parser.add_argument("--clear-cache", action="store_true", help="Remove every API cache file, not only expired ones.")
        parser.add_argument("--run-days", type=int, default=RUN_DAYS)

    def handle(self, *args, **opts):
        from meesho_app import meesho_return_claim
        out = {"runs_deleted": prune_runs(opts["run_days"])}
        files, freed = prune_api_cache(clear=opts["clear_cache"])
        out.update(cache_files_deleted=files, cache_mb_freed=round(freed / 1048576, 1))
        meesho_return_claim._sweep_uploads()
        out["uploads_swept"] = True
        self.stdout.write(json.dumps(out))
