"""
Which commit is actually serving.

Exists so a deploy can be *verified* rather than assumed. The production box is
updated by a pull-based script (deploy/hostinger/autodeploy.sh), and when that
script fails part-way — a broken migration, a pull that won't fast-forward —
the old build keeps serving perfectly happily on port 80. A liveness check
cannot tell that apart from a successful deploy; a commit hash can.

Deliberately unauthenticated and free of database access: it has to answer even
when the app is otherwise unhealthy, and it discloses nothing beyond a commit
id that is already public on GitHub.
"""

import subprocess
from pathlib import Path

from django.conf import settings
from django.http import JsonResponse

# Resolved once per process. A restart is part of every deploy, so this cannot
# go stale without the deploy having failed — which is exactly what we want it
# to reveal.
_SHA = None


def _read_sha():
    root = Path(settings.BASE_DIR).parent

    # Written by deploy/hostinger/update.sh once a deploy has fully succeeded.
    # Preferred over asking git, because it means "this build was deployed",
    # not merely "the working tree is at this commit".
    stamp = root / ".deployed_sha"
    try:
        text = stamp.read_text().strip()
        if text:
            return text[:40]
    except OSError:
        pass

    # Local development, where nothing writes the stamp.
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root, capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0:
            return out.stdout.strip()[:40]
    except (OSError, subprocess.SubprocessError):
        pass

    return "unknown"


def version(request):
    global _SHA
    if _SHA is None:
        _SHA = _read_sha()
    return JsonResponse({"sha": _SHA, "short": _SHA[:7]})
