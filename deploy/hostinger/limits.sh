#!/usr/bin/env bash
#
# Keep the VPS's memory and disk in bounds. Run as root — autodeploy.sh calls it
# on every tick (it does nothing once everything is in place), or by hand:
#
#   sudo bash /home/deploy/meesho-p/deploy/hostinger/limits.sh
#
# What grew, and what this does about it:
#
#   DISK
#   * MySQL's binary log. On by default in MySQL 8, kept 30 days, and with
#     binlog_row_image=FULL every UPDATE writes the whole row twice — the sync
#     touches each order snapshot (a JSON list of up to thousands of orders)
#     every few minutes, so the binlog grew by GBs while the data stayed ~100 MB.
#     -> rows logged minimally, kept 3 days, older ones purged now.
#   * systemd's journal (gunicorn / Sidekiq logs) -> capped at 200 MB.
#   * build folders update.sh moved aside because root owned them
#     (.node_modules_stale_…) — never deleted -> removed after a day.
#   * apt's package cache, the autodeploy log -> cleaned / trimmed.
#
#   MEMORY
#   * gunicorn: 3 workers that never restart, so whatever a big upload or
#     report allocated stayed for good -> 2 workers x 4 threads (same or more
#     requests at once, one worker's memory less), each recycled after ~500
#     requests, and a ceiling so one runaway can't take the box down.
#   * Sidekiq (Ruby) -> MALLOC_ARENA_MAX=2 (Ruby's glibc arenas are the usual
#     cause of a worker's memory creeping up) and a ceiling; the Django
#     commands and ffmpeg it starts count inside that ceiling.
#   * MySQL -> performance_schema off (~150 MB it holds for monitoring nobody
#     here reads).
#
# Every change is checked and rolled back if the service doesn't come back up.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
stamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }
say() { echo "$(stamp) limits: $*"; }

[ "$(id -u)" -eq 0 ] || { echo "limits.sh must run as root"; exit 1; }

has_unit() { systemctl list-unit-files "$1.service" 2>/dev/null | grep -q "^$1.service"; }

# Install $2 (content) as file $1 if it differs. Returns 0 when it changed.
put() {
  local dest="$1" content="$2"
  if [ -f "$dest" ] && [ "$(cat "$dest")" = "$content" ]; then return 1; fi
  mkdir -p "$(dirname "$dest")"
  printf '%s\n' "$content" > "$dest.new" && mv "$dest.new" "$dest"
  return 0
}

# A systemd drop-in for $1; restarts the service when it changed, and takes the
# drop-in out again if the service then fails to start.
dropin() {
  local svc="$1" content="$2" file="/etc/systemd/system/$1.service.d/zz-limits.conf"
  has_unit "$svc" || return 0
  local before=""
  [ -f "$file" ] && before="$(cat "$file")"
  put "$file" "$content" || return 0
  systemctl daemon-reload
  if systemctl restart "$svc" && sleep 3 && systemctl is-active --quiet "$svc"; then
    say "$svc: limits applied"
  else
    say "!!! $svc didn't come up with the new limits — putting the old ones back"
    if [ -n "$before" ]; then printf '%s\n' "$before" > "$file"; else rm -f "$file"; fi
    systemctl daemon-reload
    systemctl restart "$svc" || true
  fi
}

# ── gunicorn (the web app) ───────────────────────────────────────────────────
VENV="$REPO_ROOT/backend/.venv"
dropin meesho "[Service]
ExecStart=
ExecStart=$VENV/bin/gunicorn meesho_project.wsgi:application --bind 127.0.0.1:8000 --workers 2 --threads 4 --worker-class gthread --max-requests 500 --max-requests-jitter 50 --timeout 120
Environment=MALLOC_ARENA_MAX=2
MemoryHigh=45%
MemoryMax=60%
OOMScoreAdjust=-100"

# ── Sidekiq (the sync worker) and its dashboard ──────────────────────────────
dropin meesho-sidekiq "[Service]
Environment=MALLOC_ARENA_MAX=2
MemoryHigh=40%
MemoryMax=55%"
dropin meesho-sidekiq-web "[Service]
Environment=MALLOC_ARENA_MAX=2
MemoryMax=10%"

# ── MySQL ────────────────────────────────────────────────────────────────────
if has_unit mysql && command -v mysql >/dev/null 2>&1 && mysql -NBe "SELECT 1" >/dev/null 2>&1; then
  # Right away, no restart: log rows minimally, keep 3 days, drop the backlog.
  if [ "$(mysql -NBe 'SELECT @@log_bin' 2>/dev/null)" = "1" ]; then
    if [ "$(mysql -NBe 'SELECT @@binlog_row_image' 2>/dev/null)" != "MINIMAL" ] \
       || [ "$(mysql -NBe 'SELECT @@binlog_expire_logs_seconds' 2>/dev/null)" -gt 259200 ] 2>/dev/null; then
      before="$(du -sh /var/lib/mysql 2>/dev/null | cut -f1)"
      mysql -e "SET PERSIST binlog_row_image='MINIMAL'; SET PERSIST binlog_expire_logs_seconds=259200;
                PURGE BINARY LOGS BEFORE NOW() - INTERVAL 3 DAY;" \
        && say "mysql: binary log now minimal, kept 3 days ($before -> $(du -sh /var/lib/mysql 2>/dev/null | cut -f1))" \
        || say "!!! mysql: couldn't change the binary log settings"
    fi
  fi
  # performance_schema needs a restart: written once, MySQL restarted once.
  CNF=/etc/mysql/mysql.conf.d/zz-meesho-limits.cnf
  if [ -d /etc/mysql/mysql.conf.d ] && put "$CNF" "[mysqld]
performance_schema = OFF
binlog_row_image = MINIMAL
binlog_expire_logs_seconds = 259200"; then
    if systemctl restart mysql && sleep 3 && systemctl is-active --quiet mysql; then
      say "mysql: performance_schema off (restarted)"
    else
      say "!!! mysql didn't start with $CNF — removing it"
      rm -f "$CNF"
      systemctl restart mysql || true
    fi
  fi
fi

# ── Redis: Sidekiq's queues only — a ceiling, never evicting a job ───────────
if command -v redis-cli >/dev/null 2>&1 && redis-cli ping >/dev/null 2>&1; then
  if [ "$(redis-cli config get maxmemory | tail -1)" = "0" ]; then
    redis-cli config set maxmemory 256mb >/dev/null && redis-cli config set maxmemory-policy noeviction >/dev/null \
      && redis-cli config rewrite >/dev/null 2>&1; say "redis: capped at 256 MB"
  fi
fi

# ── The journal ──────────────────────────────────────────────────────────────
if put /etc/systemd/journald.conf.d/zz-meesho.conf "[Journal]
SystemMaxUse=200M
SystemKeepFree=1G
MaxRetentionSec=14day"; then
  systemctl restart systemd-journald && journalctl --vacuum-size=200M >/dev/null 2>&1
  say "journal: capped at 200 MB"
fi

# ── Leftovers on disk ────────────────────────────────────────────────────────
find "$REPO_ROOT/frontend" "$REPO_ROOT/backend" -maxdepth 1 -name '.*_stale_*' -mmin +1440 -prune -print0 2>/dev/null \
  | while IFS= read -r -d '' d; do rm -rf "$d" && say "removed $d"; done
LOG=/home/deploy/autodeploy.log
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" && cat "$LOG.tmp" > "$LOG" && rm -f "$LOG.tmp" && say "trimmed $LOG"
fi
# apt's downloaded packages, once a day at most.
MARK=/var/tmp/meesho-apt-clean
if [ -z "$(find "$MARK" -mmin -1440 2>/dev/null)" ]; then
  apt-get clean >/dev/null 2>&1 || true
  touch "$MARK"
fi

exit 0
