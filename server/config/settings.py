import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "development-only-change-me")
DEBUG = os.getenv("DJANGO_DEBUG", os.getenv("DEBUG", "False")).lower() == "true"
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"
if not DEBUG and (SECRET_KEY == "development-only-change-me" or SECRET_KEY.startswith("replace-with-")):
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY before running with DEBUG=False")
if not DEBUG and not DEMO_MODE and not (os.getenv("JWT_SECRET_KEY") or os.getenv("JWT_SECRET")):
    raise ImproperlyConfigured("Set JWT_SECRET_KEY to the existing signing secret before production cutover")
ALLOWED_HOSTS = [host.strip() for host in os.getenv("DJANGO_ALLOWED_HOSTS", os.getenv("ALLOWED_HOSTS", "127.0.0.1,localhost")).split(",") if host.strip()]
JWT_SECRET = os.getenv("JWT_SECRET_KEY") or os.getenv("JWT_SECRET") or ("development-secret" if DEMO_MODE else SECRET_KEY)
JWT_ACCESS_TOKEN_LIFETIME = int(os.getenv("JWT_ACCESS_TOKEN_LIFETIME", "28800"))
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "180"))
ORGANIZATION_NAME = os.getenv("ORGANIZATION_NAME", "System Monitoring Health")
PORT = int(os.getenv("PORT", "8000"))

MONGODB_URI = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/system-health-monitor")
MONGODB_DATABASE = os.getenv("MONGODB_DATABASE", "")

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
CORS_ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ALLOWED_ORIGINS", FRONTEND_URL).split(",") if origin.strip()]
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS

INSTALLED_APPS = [
    "corsheaders",
    "rest_framework",
    "apps.authentication",
    "apps.systems",
    "apps.commands",
    "apps.alerts",
    "apps.reports",
    "apps.monitoring",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "common.middleware.request_logging.RequestLoggingMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
DATABASES = {"default": {"ENGINE": "django.db.backends.dummy"}}
TEST_RUNNER = "common.test_runner.MongoNoSqlTestRunner"
USE_TZ = True
TIME_ZONE = "UTC"
LANGUAGE_CODE = "en-us"

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_AUTHENTICATION_CLASSES": ["common.authentication.BearerJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle", "rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "anon": f"{RATE_LIMIT_PER_MINUTE}/minute",
        "user": f"{RATE_LIMIT_PER_MINUTE}/minute",
    },
    "EXCEPTION_HANDLER": "common.exceptions.api_exception_handler",
    "UNAUTHENTICATED_USER": None,
}

SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
X_FRAME_OPTIONS = "DENY"
DATA_UPLOAD_MAX_MEMORY_SIZE = 256 * 1024
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "0" if DEBUG else "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"structured": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "structured"}},
    "root": {"handlers": ["console"], "level": os.getenv("LOG_LEVEL", "INFO")},
}