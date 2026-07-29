#!/usr/bin/env bash
# One-shot build + deploy script to run ON the Hostinger VPS after `git pull`.
# Usage:  bash deploy/hostinger/deploy.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "==> Building frontend"
npm ci --prefix frontend
npm run build --prefix frontend

echo "==> Preparing Django template from frontend build"
mkdir -p backend/templates
cp backend/frontend_build/index.html backend/templates/index.html

echo "==> Installing Python deps"
cd backend
python3 -m venv .venv || true
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo "==> Loading env vars"
set -a
# shellcheck disable=SC1091
source "$REPO_ROOT/deploy/hostinger/.env"
set +a

echo "==> Django migrate + collectstatic + seed"
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py load_initial_data || true
python manage.py create_seed_users || true

echo "==> Restarting gunicorn service"
sudo systemctl restart meesho

echo "==> Done. Check: sudo systemctl status meesho"
