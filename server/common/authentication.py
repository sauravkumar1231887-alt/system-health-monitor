from types import SimpleNamespace

import jwt
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission

from apps.systems.repository import find_agent_system


class BearerJWTAuthentication(BaseAuthentication):
    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        if not header:
            return None
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise AuthenticationFailed("Authentication required")
        try:
            payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
        except jwt.PyJWTError as error:
            raise AuthenticationFailed("Authentication required") from error
        if not all(payload.get(key) for key in ("sub", "email", "role")):
            raise AuthenticationFailed("Authentication required")
        user = SimpleNamespace(**payload, pk=payload["sub"], is_authenticated=True)
        return user, token

    def authenticate_header(self, request):
        return "Bearer"


class AgentKeyAuthentication(BaseAuthentication):
    def authenticate(self, request):
        agent_key = request.headers.get("X-Agent-Key")
        if not agent_key:
            raise AuthenticationFailed("Valid agent key required")
        try:
            system = find_agent_system(agent_key)
        except Exception as error:
            raise AuthenticationFailed("Valid agent key required") from error
        if not system:
            raise AuthenticationFailed("Valid agent key required")
        agent = SimpleNamespace(is_authenticated=True, system=system, role="Agent", pk=system.get("_id"))
        return agent, None


class IsAdministrator(BasePermission):
    message = "Administrator role required"

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == "Administrator")


class IsAgent(BasePermission):
    message = "Valid agent key required"

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == "Agent")