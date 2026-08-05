from datetime import timedelta
from pathlib import Path
import os

try:
    import dj_database_url
except ImportError:  # optional locally until requirements are installed
    dj_database_url = None

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-change-me-in-production-use-env-var")

DEBUG = os.environ.get("DJANGO_DEBUG", "true").lower() == "true"

raw_hosts = os.environ.get("DJANGO_ALLOWED_HOSTS", "*")
ALLOWED_HOSTS = [h.strip() for h in raw_hosts.split(",") if h.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "accounts",
    "meesho_app",
]

AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

try:
    import whitenoise  # noqa: F401
    MIDDLEWARE.insert(2, "whitenoise.middleware.WhiteNoiseMiddleware")
except ImportError:
    pass

ROOT_URLCONF = "meesho_project.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "meesho_project.wsgi.application"

# ── Database ─────────────────────────────────────────────────────────────────
# Priority:
# 1) DATABASE_URL (recommended for deployment)
# 2) DB_ENGINE=mysql with DB_* vars
# 3) SQLite fallback (works out-of-the-box on local and simple free deploys)
if os.environ.get("DATABASE_URL") and dj_database_url:
    DATABASES = {
        "default": dj_database_url.parse(os.environ["DATABASE_URL"], conn_max_age=600, ssl_require=False)
    }
elif os.environ.get("DB_ENGINE", "sqlite").lower() == "mysql":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.mysql",
            "NAME": os.environ.get("DB_NAME", "meesho_profit"),
            "USER": os.environ.get("DB_USER", "root"),
            "PASSWORD": os.environ.get("DB_PASSWORD", "root"),
            "HOST": os.environ.get("DB_HOST", "localhost"),
            "PORT": os.environ.get("DB_PORT", "3306"),
            "OPTIONS": {
                "charset": "utf8mb4",
                "init_command": "SET sql_mode='STRICT_TRANS_TABLES'",
            },
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            # SQLITE_PATH points at a persistent disk in prod (e.g.
            # /var/data/db.sqlite3); falls back to the repo path locally.
            "NAME": os.environ.get("SQLITE_PATH", str(BASE_DIR / "db.sqlite3")),
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_TZ = True
USE_I18N = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = []
_frontend_build = BASE_DIR / "frontend_build"
if _frontend_build.exists():
    # Vite builds with base "/static/frontend/", so the emitted index.html
    # references assets at /static/frontend/assets/...  Collect the build
    # under a matching "frontend" prefix so those URLs resolve.
    STATICFILES_DIRS.append(("frontend", _frontend_build))
if any(m == "whitenoise.middleware.WhiteNoiseMiddleware" for m in MIDDLEWARE):
    # Vite already fingerprints asset filenames for cache-busting, so use
    # the non-manifest storage: files are served under their real on-disk
    # names, which is exactly what the built index.html references.
    STATICFILES_STORAGE = "whitenoise.storage.CompressedStaticFilesStorage"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# CORS/CSRF
CORS_ALLOW_ALL_ORIGINS = os.environ.get("CORS_ALLOW_ALL", "true").lower() == "true"
raw_cors = os.environ.get("CORS_ALLOWED_ORIGINS", "")
if raw_cors:
    CORS_ALLOWED_ORIGINS = [u.strip() for u in raw_cors.split(",") if u.strip()]

raw_csrf = os.environ.get("CSRF_TRUSTED_ORIGINS", "")
if raw_csrf:
    CSRF_TRUSTED_ORIGINS = [u.strip() for u in raw_csrf.split(",") if u.strip()]

# The browser extension calls this API from an `Origin: chrome-extension://<id>`,
# where <id> is derived from the unpacked folder and so differs per install —
# there is no fixed origin to add to CORS_ALLOWED_ORIGINS. A regex is the only
# workable form. Without this, production (CORS_ALLOW_ALL=false, origins locked
# to rudam.in) rejects every request the extension makes.
#
# This grants no read access on its own: every endpoint the extension uses still
# requires a valid JWT, and tokens live in that user's browser only.
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^chrome-extension://[a-p]{32}$",   # Chrome / Edge / Brave (32 chars, a–p)
    r"^moz-extension://[0-9a-f-]{36}$",  # Firefox (a UUID per install)
]

# Extension requests are JWT-bearing, not cookie-bearing, so credentialed CORS is
# not needed — keeping it off means the wildcard-ish regex above can never be
# used to ride along on someone's session cookie.
CORS_ALLOW_CREDENTIALS = False

# ── Reverse proxy (nginx / Cloudflare) ───────────────────────────────────────
# When the app runs behind nginx (and optionally Cloudflare), the TLS is
# terminated upstream and the request reaches Django over plain HTTP. nginx
# forwards the original scheme in the X-Forwarded-Proto header, so trust it to
# detect HTTPS correctly (fixes request.is_secure(), secure cookies, and
# absolute URL building). Enable via TRUST_PROXY_SSL_HEADER=true in the env.
if os.environ.get("TRUST_PROXY_SSL_HEADER", "false").lower() == "true":
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
}

# File upload limit: 50 MB
DATA_UPLOAD_MAX_MEMORY_SIZE = 52428800
FILE_UPLOAD_MAX_MEMORY_SIZE = 52428800
