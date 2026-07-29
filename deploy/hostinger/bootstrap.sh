#!/usr/bin/env bash
# Full server bootstrap for a FRESH Ubuntu 22.04/24.04 VPS, run as root.
# Recreates the entire deployment: system packages, deploy user, MySQL, the app
# (build + migrate + seed), gunicorn systemd service, and nginx on port 80.
#
# HTTPS is handled by Cloudflare (set SSL mode to "Flexible" after this runs),
# so no origin certificate/certbot is needed here — nginx listens on port 80 and
# Cloudflare terminates TLS for visitors.
#
# Usage (as root):
#   curl -fsSL https://raw.githubusercontent.com/vivekgarrg/meesho-p/main/deploy/hostinger/bootstrap.sh -o bootstrap.sh
#   DOMAIN=rudam.in SEED_ADMIN_PASSWORD='choose-admin-pass' bash bootstrap.sh
#
# Optional env overrides: APP_USER, REPO_URL, DB_NAME, DB_USER, DB_PASSWORD,
# DEPLOY_PASSWORD, DJANGO_SECRET_KEY.
set -euo pipefail

# ── Config (override via environment) ────────────────────────────────────────
APP_USER="${APP_USER:-deploy}"
REPO_URL="${REPO_URL:-https://github.com/vivekgarrg/meesho-p.git}"
DOMAIN="${DOMAIN:-rudam.in}"
APP_DIR="/home/${APP_USER}/meesho-p"

DB_NAME="${DB_NAME:-meesho_profit}"
DB_USER="${DB_USER:-meesho}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"

DEPLOY_PASSWORD="${DEPLOY_PASSWORD:-$(openssl rand -hex 12)}"
DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY:-$(python3 -c 'import secrets;print(secrets.token_urlsafe(50))')}"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-ChangeMe123!}"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

echo "==> [1/8] Installing system packages"
apt-get update -y
apt-get upgrade -y -o Dpkg::Options::="--force-confold" -o Dpkg::Options::="--force-confdef"
apt-get install -y -o Dpkg::Options::="--force-confold" \
    nginx git curl ca-certificates \
    python3-venv python3-pip pkg-config libmysqlclient-dev \
    mysql-server
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> [2/8] Creating ${APP_USER} user"
if ! id "${APP_USER}" >/dev/null 2>&1; then
    useradd -m -s /bin/bash "${APP_USER}"
    usermod -aG sudo "${APP_USER}"
fi
echo "${APP_USER}:${DEPLOY_PASSWORD}" | chpasswd

echo "==> [3/8] Setting up MySQL database"
systemctl enable --now mysql
mysql <<SQL
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

echo "==> [4/8] Cloning repository"
if [ ! -d "${APP_DIR}/.git" ]; then
    sudo -u "${APP_USER}" git clone "${REPO_URL}" "${APP_DIR}"
else
    sudo -u "${APP_USER}" git -C "${APP_DIR}" pull --ff-only
fi

echo "==> [5/8] Writing environment file"
install -d -o "${APP_USER}" -g "${APP_USER}" "${APP_DIR}/deploy/hostinger"
cat > "${APP_DIR}/deploy/hostinger/.env" <<ENV
DJANGO_SECRET_KEY=${DJANGO_SECRET_KEY}
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=${DOMAIN},www.${DOMAIN}
CSRF_TRUSTED_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}
CORS_ALLOW_ALL=false
CORS_ALLOWED_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}
TRUST_PROXY_SSL_HEADER=true
DB_ENGINE=mysql
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_HOST=127.0.0.1
DB_PORT=3306
SEED_ADMIN_PASSWORD=${SEED_ADMIN_PASSWORD}
ENV
chown "${APP_USER}:${APP_USER}" "${APP_DIR}/deploy/hostinger/.env"
chmod 600 "${APP_DIR}/deploy/hostinger/.env"

echo "==> [6/8] Building frontend + Python app (as ${APP_USER})"
sudo -u "${APP_USER}" bash <<EOSU
set -euo pipefail
cd "${APP_DIR}"
npm ci --prefix frontend
npm run build --prefix frontend
mkdir -p backend/templates
cp backend/frontend_build/index.html backend/templates/index.html
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
set -a; source "${APP_DIR}/deploy/hostinger/.env"; set +a
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py load_initial_data || true
python manage.py create_seed_users || true
EOSU

echo "==> [7/8] Installing gunicorn service"
cp "${APP_DIR}/deploy/hostinger/gunicorn.service" /etc/systemd/system/meesho.service
systemctl daemon-reload
systemctl enable --now meesho
systemctl restart meesho

echo "==> [8/8] Configuring nginx (port 80; Cloudflare terminates TLS)"
# Let nginx (www-data) traverse into the deploy home dir to serve static files.
chmod o+x "/home/${APP_USER}"
chmod -R o+rX "${APP_DIR}/backend/staticfiles"
cp "${APP_DIR}/deploy/hostinger/nginx.conf" /etc/nginx/sites-available/meesho
sed -i "s/server_name .*/server_name ${DOMAIN} www.${DOMAIN};/" /etc/nginx/sites-available/meesho
sed -i "s#alias /home/deploy/#alias /home/${APP_USER}/#" /etc/nginx/sites-available/meesho
ln -sf /etc/nginx/sites-available/meesho /etc/nginx/sites-enabled/meesho
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

echo
echo "============================================================"
echo " Bootstrap complete."
echo "   Domain:            ${DOMAIN}"
echo "   deploy user pass:  ${DEPLOY_PASSWORD}"
echo "   DB name/user:      ${DB_NAME} / ${DB_USER}"
echo "   DB password:       ${DB_PASSWORD}"
echo "   Admin login:       admin / ${SEED_ADMIN_PASSWORD}"
echo
echo " NEXT: In Cloudflare -> SSL/TLS -> Overview, set mode to FLEXIBLE."
echo " Then open https://${DOMAIN}"
echo "============================================================"
