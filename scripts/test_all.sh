#!/usr/bin/env bash
#
# Every test suite, in one go — run before pushing:
#
#   bash scripts/test_all.sh            # everything
#   bash scripts/test_all.sh ingestion  # only the data-ingestion / profit suites
#
#   Django   backend/meesho_app/test_*.py — the middleware (orders, returns,
#            payments → tables), the end-to-end pipeline with the response
#            cache on (test_ingestion_pipeline: new data → profit at once),
#            photos, settling, the packing desk, WhatsApp/Telegram/email
#   Rails    sync/test — the worker's jobs (what is fetched from Meesho, paging,
#            rate limits, sessions, schedules)
#   Frontend a production build (catches broken imports / JSX)
#
# Exits non-zero if any suite fails, after running them all.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${MEESHO_DJANGO_PYTHON:-$( [ -x "$ROOT/backend/.venv/bin/python" ] && echo "$ROOT/backend/.venv/bin/python" || echo python3 )}"
failed=()

run() {
  local name="$1"; shift
  echo; echo "━━━ $name ━━━"
  if "$@"; then echo "✓ $name"; else echo "✗ $name"; failed+=("$name"); fi
}

if [ "${1:-}" = "ingestion" ]; then
  run "Django: ingestion & profit" bash -c "cd '$ROOT/backend' && '$PY' manage.py test --noinput \
    meesho_app.test_ingestion_pipeline meesho_app.test_sync_middleware meesho_app.test_meesho_images_and_settle \
    meesho_app.test_meesho_returns meesho_app.test_meesho_sync meesho_app.test_api_cache"
  run "Rails: worker jobs" bash -c "cd '$ROOT/sync' && bin/rails test"
else
  run "Django: all" bash -c "cd '$ROOT/backend' && '$PY' manage.py test --noinput meesho_app accounts"
  run "Rails: worker jobs" bash -c "cd '$ROOT/sync' && bin/rails test"
  run "Frontend: build" bash -c "cd '$ROOT/frontend' && npm run build --silent >/dev/null"
fi

echo
if [ ${#failed[@]} -eq 0 ]; then echo "All suites passed."; else echo "Failed: ${failed[*]}"; exit 1; fi
