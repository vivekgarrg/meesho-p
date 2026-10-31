#!/usr/bin/env bash
#
# Pull-based deploy. Run from cron ON the VPS; deploys itself when origin/main
# moves ahead.
#
# Why this exists: the GitHub Actions deploy pushes over SSH, and the runner
# gets "dial tcp <host>:22: i/o timeout" — its packets are dropped before any
# handshake, while the same port answers fine from other addresses. That is a
# source-IP block (fail2ban, or a firewall allow-list), and GitHub's runners
# come from enormous rotating ranges, so allow-listing them is not realistic.
#
# Turning the deploy around removes SSH from the path entirely: nothing has to
# reach *in*, the server reaches *out* to GitHub over HTTPS. No inbound rule, no
# key on a runner, nothing to ban.
#
# Install (once, from the Hostinger browser console if SSH is blocked):
#
#   chmod +x ~/meesho-p/deploy/hostinger/autodeploy.sh
#   crontab -e
#   # check every 2 minutes:
#   */2 * * * * /home/deploy/meesho-p/deploy/hostinger/autodeploy.sh >> /home/deploy/autodeploy.log 2>&1
#
# The GitHub Actions workflow can stay as it is — when it manages to connect it
# deploys, and when it doesn't this picks the commit up within two minutes.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

stamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }

# One deploy at a time. A build plus migrations can outlast the cron interval,
# and two interleaving would be far worse than a skipped tick.
#
# mkdir rather than flock: it is atomic on every POSIX system and needs no
# util-linux, so this behaves the same on the VPS and anywhere it is tested. A
# missing flock would otherwise look exactly like "lock held" and skip every
# deploy in silence.
LOCK="/tmp/rudam-autodeploy.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # A lock left behind by a killed run would block deploys forever, so treat a
  # stale one (older than an hour — far longer than any real deploy) as gone.
  if [ -d "$LOCK" ] && [ -z "$(find "$LOCK" -maxdepth 0 -mmin -60 2>/dev/null)" ]; then
    echo "$(stamp) clearing a stale lock"
    rmdir "$LOCK" 2>/dev/null || true
    mkdir "$LOCK" 2>/dev/null || { echo "$(stamp) could not take the lock"; exit 0; }
  else
    echo "$(stamp) another deploy is still running — skipping"
    exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

git fetch --quiet origin main

# What is actually serving: update.sh stamps .deployed_sha only once every
# step succeeded. HEAD is no guide — update.sh moves it to origin/main before
# building, so a deploy that failed half-way left HEAD current and was never
# tried again, the old code serving on in silence.
LOCAL="$(cat .deployed_sha 2>/dev/null || git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0            # nothing new; stay silent so the log only shows real work
fi

# A deploy of this commit that failed is tried again every 15 minutes, not on
# every tick (a full build every 2 minutes would only bury the log).
ATTEMPT=".deploy_attempt"
if [ "$(cut -d' ' -f1 "$ATTEMPT" 2>/dev/null)" = "$REMOTE" ] \
   && [ -n "$(find "$ATTEMPT" -mmin -15 2>/dev/null)" ]; then
  exit 0
fi
echo "$REMOTE $(stamp)" > "$ATTEMPT"

echo "=================================================================="
echo "$(stamp) deploying ${LOCAL:0:7} -> ${REMOTE:0:7}"
git --no-pager log --oneline "$LOCAL..$REMOTE" | sed 's/^/    /'
echo "=================================================================="

if ! bash deploy/hostinger/update.sh; then
  echo "$(stamp) deploy of ${REMOTE:0:7} FAILED — still serving ${LOCAL:0:7}; trying again in 15 minutes"
  exit 1
fi

echo "$(stamp) deployed ${REMOTE:0:7}"
