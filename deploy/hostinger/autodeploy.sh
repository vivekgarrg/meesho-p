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
# Install (once, as root, from the Hostinger browser console if SSH is blocked):
#
#   chmod +x /home/deploy/meesho-p/deploy/hostinger/autodeploy.sh
#   crontab -e          # root's crontab — check every 2 minutes:
#   */2 * * * * /home/deploy/meesho-p/deploy/hostinger/autodeploy.sh >> /home/deploy/autodeploy.log 2>&1
#
# Run by root, it does the code work as the deploy user (git, build, migrate —
# so no file ends up owned by root) and then restarts the services itself:
# gunicorn, the sync worker and its dashboard — the worker must restart to run
# new code. It also installs the sudoers rule (sudoers-meesho) that lets the
# deploy user restart them, for a deploy run by hand. Run by the deploy user
# (the older way), the restarts depend on that rule being installed.
#
# The GitHub Actions workflow can stay as it is — when it manages to connect it
# deploys, and when it doesn't this picks the commit up within two minutes.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

stamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }

DEPLOY_USER="deploy"
AS_ROOT=0
[ "$(id -u)" -eq 0 ] && AS_ROOT=1
# Code work runs as the deploy user, whoever runs this.
as_deploy() {
  if [ "$AS_ROOT" -eq 1 ]; then sudo -u "$DEPLOY_USER" -H "$@"; else "$@"; fi
}

if [ "$AS_ROOT" -eq 1 ]; then
  # The rule that lets the deploy user restart the services (a hand-run update.sh).
  RULE="$REPO_ROOT/deploy/hostinger/sudoers-meesho"
  if [ -f "$RULE" ] && ! cmp -s "$RULE" /etc/sudoers.d/meesho 2>/dev/null; then
    if visudo -cf "$RULE" >/dev/null 2>&1; then
      install -m 440 -o root -g root "$RULE" /etc/sudoers.d/meesho && echo "$(stamp) installed /etc/sudoers.d/meesho"
    else
      echo "$(stamp) !!! sudoers-meesho doesn't parse — not installed"
    fi
  fi
fi

# Restart what runs the code, as root — every service that is installed.
restart_services() {
  for svc in meesho meesho-sidekiq meesho-sidekiq-web; do
    if systemctl list-unit-files "$svc.service" 2>/dev/null | grep -q "^$svc.service"; then
      if systemctl restart "$svc"; then echo "  restarted $svc"; else echo "  !!! could not restart $svc"; fi
    fi
  done
}

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

as_deploy git -C "$REPO_ROOT" fetch --quiet origin main

# What is actually serving: update.sh stamps .deployed_sha only once every
# step succeeded. HEAD is no guide — update.sh moves it to origin/main before
# building, so a deploy that failed half-way left HEAD current and was never
# tried again, the old code serving on in silence.
LOCAL="$(cat .deployed_sha 2>/dev/null || as_deploy git -C "$REPO_ROOT" rev-parse HEAD)"
REMOTE="$(as_deploy git -C "$REPO_ROOT" rev-parse origin/main)"

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
as_deploy sh -c "echo '$REMOTE $(stamp)' > '$REPO_ROOT/$ATTEMPT'"

echo "=================================================================="
echo "$(stamp) deploying ${LOCAL:0:7} -> ${REMOTE:0:7}"
as_deploy git -C "$REPO_ROOT" --no-pager log --oneline "$LOCAL..$REMOTE" | sed 's/^/    /'
echo "=================================================================="

if ! as_deploy env AUTODEPLOY_ROOT="$AS_ROOT" bash "$REPO_ROOT/deploy/hostinger/update.sh"; then
  echo "$(stamp) deploy of ${REMOTE:0:7} FAILED — still serving ${LOCAL:0:7}; trying again in 15 minutes"
  exit 1
fi
if [ "$AS_ROOT" -eq 1 ]; then
  restart_services            # the new code takes over: web app, sync worker, dashboard
fi

echo "$(stamp) deployed ${REMOTE:0:7}"
