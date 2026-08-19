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

echo "==> Reconciling schema drift from migrations removed from this branch"
# Commit 212ec5e briefly added meesho_app.0039/0040/0041 and
# accounts.0010 (a cropped_pdf/in_current_batch pair on LabelOrder, the
# salaries table, ExpenseInvoiceItem.gst_percent, and
# BusinessProfile.deduct_salaries) then dropped them again before this
# branch's current tip. Any environment that had already run those
# migrations keeps the columns/table and the django_migrations bookkeeping
# rows even though the migration files are gone, which then makes plain
# `migrate` unable to apply cleanly and made inserts fail on
# in_current_batch's NOT NULL. This block brings such an environment back
# in line with the branch. Each step checks information_schema first, so
# once the drift is gone this is a no-op — safe to leave in permanently.
# MySQL-only (this deploy's database), not meant for local sqlite dev.
#
# ExpenseInvoiceItem.gst_percent came back for real shortly after as
# meesho_app.0039_expenseinvoiceitem_gst_percent (a different migration
# number than the reverted 0041, same column) — but this block kept
# unconditionally dropping the column on every deploy, and since
# django_migrations still listed the *current* 0039 as applied (its name
# never matched the orphan-cleanup list below), `migrate` never recreated
# it. That silently broke every Expenses API call touching invoice items
# in production. The drop is gone; the add-back-if-missing step repairs
# any environment the drop already hit.
python manage.py shell -c "
from django.db import connection

def drop_column_if_exists(table, column):
    with connection.cursor() as cur:
        cur.execute('''
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s
        ''', [table, column])
        if cur.fetchone()[0]:
            cur.execute(f'ALTER TABLE {table} DROP COLUMN {column}')
            print(f'  dropped {table}.{column}')

def add_column_if_missing(table, column, ddl):
    with connection.cursor() as cur:
        cur.execute('''
            SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s
        ''', [table, column])
        if not cur.fetchone()[0]:
            cur.execute(f'ALTER TABLE {table} ADD COLUMN {column} {ddl}')
            print(f'  restored {table}.{column}')

def drop_table_if_exists(table):
    with connection.cursor() as cur:
        cur.execute('''
            SELECT COUNT(*) FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
        ''', [table])
        if cur.fetchone()[0]:
            cur.execute(f'DROP TABLE {table}')
            print(f'  dropped table {table}')

drop_column_if_exists('label_orders', 'cropped_pdf')
drop_column_if_exists('label_orders', 'in_current_batch')
drop_table_if_exists('salaries')
drop_column_if_exists('business_profiles', 'deduct_salaries')
add_column_if_missing('expense_invoice_items', 'gst_percent', 'DECIMAL(5,2) NULL')

with connection.cursor() as cur:
    cur.execute('''DELETE FROM django_migrations
                    WHERE (app='meesho_app' AND name IN (
                        '0039_labelorder_cropped_pdf_labelorder_in_current_batch',
                        '0040_salary'
                    )) OR (app='accounts' AND name='0010_businessprofile_deduct_salaries')''')
    if cur.rowcount:
        print(f'  cleared {cur.rowcount} orphaned django_migrations row(s)')
"

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
