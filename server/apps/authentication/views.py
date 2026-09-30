import logging
import re
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from django.conf import settings
from django.utils.crypto import constant_time_compare
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from common.database import collection
from common.fixtures import demo_collection
from common.logging_utils import log_failure
from common.serialization import mongo_document
from common.status import DEFAULT_SETTINGS


logger = logging.getLogger("authentication")


class HealthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        database_status = "demo"
        response_status = 200
        if not settings.DEMO_MODE:
            try:
                collection("settings").database.command("ping")
                database_status = "connected"
            except Exception as error:
                log_failure(logger, "MongoDB health check failed", error)
                database_status = "disconnected"
                response_status = 503
        return Response({
            "status": "ok" if response_status == 200 else "error",
            "backend": "healthy",
            "database": database_status,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "demoMode": settings.DEMO_MODE,
        }, status=response_status)


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        email = body.get("email")
        password = body.get("password")
        if not isinstance(email, str) or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not isinstance(password, str) or len(password) < 6:
            return Response({"message": "Valid email and password are required"}, status=400)

        user = None
        if not settings.DEMO_MODE:
            try:
                user = collection("users").find_one({"email": email})
            except Exception as error:
                log_failure(logger, "User lookup failed", error)
                return Response({"message": "Authentication service unavailable"}, status=503)

        if user:
            try:
                password_hash = user.get("passwordHash", "")
                password_hash = password_hash.encode() if isinstance(password_hash, str) else password_hash
                valid = bcrypt.checkpw(password.encode(), password_hash)
            except (ValueError, TypeError):
                valid = False
        else:
            valid = (settings.DEMO_MODE and email in {"admin@sentinel.local", "viewer@sentinel.local"}
                     and constant_time_compare(password, "admin123"))
        if not valid:
            logger.warning("Login rejected")
            return Response({"message": "Invalid credentials"}, status=401)

        role = user.get("role") if user else ("Viewer" if email.startswith("viewer") else "Administrator")
        name = user.get("name") if user else ("Viewer" if role == "Viewer" else "Alex Morgan")
        identity = {"sub": str(user.get("_id", email)) if user else email, "email": email, "role": role}
        now = datetime.now(timezone.utc)
        token = jwt.encode({**identity, "iat": now, "exp": now + timedelta(seconds=settings.JWT_ACCESS_TOKEN_LIFETIME)}, settings.JWT_SECRET, algorithm="HS256")
        event = {"userId": identity["sub"], "userEmail": email, "action": "LOGIN", "timestamp": now, "result": "Successful", "sourceIP": request.META.get("REMOTE_ADDR", "")}
        try:
            if settings.DEMO_MODE:
                from common.fixtures import _DEMO
                _DEMO["auditlogs"].insert(0, {"_id": __import__("uuid").uuid4().hex, **event})
            else:
                collection("auditlogs").insert_one(event)
        except Exception:
            log_failure(logger, "Login audit event could not be recorded", error)
        return Response({"token": token, "user": {"name": name, "role": role}})