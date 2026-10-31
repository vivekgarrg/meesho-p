"""What every middleware returns, and the cache invalidation they share."""

from .. import api_cache

SAMPLES = 10


class Result:
    """Counts of what was written, and the rows refused with why."""

    def __init__(self):
        self.counts = {}
        self.rejected = 0
        self.reasons = {}
        self.samples = []

    def add(self, key, n=1):
        self.counts[key] = self.counts.get(key, 0) + n

    def merge(self, counts):
        for k, v in (counts or {}).items():
            if isinstance(v, int):
                self.add(k, v)

    def reject(self, reason, row=None):
        self.rejected += 1
        self.reasons[reason] = self.reasons.get(reason, 0) + 1
        if len(self.samples) < SAMPLES:
            self.samples.append({"reason": reason, "row": {k: row.get(k) for k in list(row)[:8]} if isinstance(row, dict) else row})

    def as_dict(self):
        return {**self.counts, "rejected": self.rejected, "reject_reasons": self.reasons, "rejected_samples": self.samples}


def missing(row, *fields):
    """The required fields a row lacks (None, '' or NaN count as missing)."""
    out = []
    for f in fields:
        v = row.get(f)
        if v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, float) and v != v):
            out.append(f)
    return out


# Invalidate the cached screens of the businesses a block writes, once at the end.
deferred_bumps = api_cache.deferred_bumps
