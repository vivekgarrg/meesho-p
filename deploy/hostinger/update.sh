#!/usr/bin/env bash
# One-command production update. Run as the `deploy` user ON the VPS:
#   bash deploy/hostinger/update.sh
# Also used by the GitHub Actions auto-deploy workflow.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "==> Pulling latest code"
# reset --hard rather than pull --ff-only: this checkout only ever holds
# deployed code, never unique local work, so it's safe to force it to match
# origin exactly. That also makes it resilient to origin/main being rewritten
# (e.g. a force-push) — a plain --ff-only pull refuses in that case with
# "Not possible to fast-forward" even though "match origin" is unambiguous.
git fetch origin main
git reset --hard origin/main

echo "==> Building frontend"
npm ci --prefix frontend
npm run build --prefix frontend
# No copy step: Django reads the built index.html from frontend_build directly
# (see TEMPLATES DIRS). Copying it over the tracked templates/index.html left
# that file permanently modified on the server and broke the next git pull.

echo "==> Python deps + migrate + collectstatic"
cd backend
python3 -m venv .venv || true
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
set -a
# shellcheck disable=SC1091
source "$REPO_ROOT/deploy/hostinger/.env"
set +a
python manage.py migrate --noinput
python manage.py collectstatic --noinput
# Seed commands are idempotent: they no-op once the DB has data.
python manage.py load_initial_data || true
python manage.py create_seed_users || true

echo "==> Ensuring static files are readable by nginx"
chmod o+x "$HOME" 2>/dev/null || true
chmod -R o+rX "$REPO_ROOT/backend/staticfiles" 2>/dev/null || true

# Written only once everything above has succeeded, so /api/version/ reports
# the commit that is genuinely serving rather than whatever the working tree
# happens to be sitting at after a half-finished deploy.
echo "==> Stamping the deployed commit"
git -C "$REPO_ROOT" rev-parse HEAD > "$REPO_ROOT/.deployed_sha"

echo "==> Restarting gunicorn service"
sudo systemctl restart meesho

echo "==> Done. $(sudo systemctl is-active meesho) at $(cat "$REPO_ROOT/.deployed_sha")"
