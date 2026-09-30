import logging
import uuid
from datetime import datetime, timezone

from bson import ObjectId
from django.conf import settings
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from common.authentication import AgentKeyAuthentication, IsAdministrator, IsAgent
from common.database import collection
from common.fixtures import demo_collection
from common.logging_utils import log_failure
from common.serialization import json_value, mongo_document
from apps.systems.repository import get_system, insert_document, list_named


logger = logging.getLogger("monitoring.commands")


def command_by_id(command_id):
    if settings.DEMO_MODE:
        return next((item for item in demo_collection("commands") if item["_id"] == command_id), None)
    selector = {"_id": command_id}
    if ObjectId.is_valid(command_id):
        selector = {"_id": ObjectId(command_id)}
    return mongo_document(collection("commands").find_one(selector))


def save_command(command):
    if settings.DEMO_MODE:
        from common.fixtures import _DEMO
        for existing in _DEMO["commands"]:
            if existing["_id"] == command["_id"]:
                existing.update(command)
                break
        return
    command_id = ObjectId(command["_id"]) if ObjectId.is_valid(command["_id"]) else command["_id"]
    collection("commands").update_one({"_id": command_id}, {"$set": {key: command[key] for key in ("status", "error", "result", "executedAt") if key in command}})


def append_audit(request, action, system=None, result="Successful"):
    entry = {"_id": str(uuid.uuid4()), "userId": getattr(request.user, "sub", "system"), "userEmail": getattr(request.user, "email", "agent"), "sourceIP": request.META.get("REMOTE_ADDR", ""), "timestamp": datetime.now(timezone.utc), "action": action, "result": result}
    if system:
        entry["systemId"] = system.get("_id")
        entry["systemName"] = system.get("hostname")
    if settings.DEMO_MODE:
        from common.fixtures import _DEMO
        _DEMO["auditlogs"].insert(0, entry)
    else:
        collection("auditlogs").insert_one(entry)


class CommandsView(APIView):
    def get(self, request):
        try:
            return Response(json_value(list_named("commands")))
        except Exception as error:
            log_failure(logger, "Command history query failed", error)
            return Response({"message": "Unable to load commands"}, status=503)


class SystemActionView(APIView):
    permission_classes = [IsAuthenticated, IsAdministrator]

    def post(self, request, system_id, action):
        normalized = action.upper()
        if normalized not in {"RESTART", "SHUTDOWN"}:
            return Response({"message": "Not found"}, status=404)
        system = get_system(system_id)
        if not system:
            return Response({"message": "System not found"}, status=404)
        system_id = ObjectId(system["_id"]) if ObjectId.is_valid(system["_id"]) else system["_id"]
        if settings.DEMO_MODE:
            system_id = system["_id"]
        command = {"_id": str(uuid.uuid4()), "systemId": system_id, "systemName": system.get("hostname"), "type": normalized, "requestedBy": request.user.email, "status": "PENDING", "createdAt": datetime.now(timezone.utc)}
        try:
            insert_document("commands", command)
        except Exception as error:
            log_failure(logger, "Remote command could not be queued", error)
            return Response({"message": "Unable to queue command"}, status=503)
        try:
            append_audit(request, normalized, system, "Queued")
        except Exception as error:
            log_failure(logger, "Remote command audit event could not be recorded", error)
        return Response(json_value(command), status=status.HTTP_202_ACCEPTED)


class AgentCommandPollView(APIView):
    authentication_classes = [AgentKeyAuthentication]
    permission_classes = [IsAgent]

    def post(self, request):
        system_id = request.user.system["_id"]
        if settings.DEMO_MODE:
            commands = [item for item in demo_collection("commands") if item.get("systemId") == system_id and item.get("status") == "PENDING"]
        else:
            mongo_id = ObjectId(system_id) if ObjectId.is_valid(system_id) else system_id
            commands = [mongo_document(item) for item in collection("commands").find({"systemId": {"$in": [system_id, mongo_id]}, "status": "PENDING"})]
        return Response({"commands": [{"id": item["_id"], "type": item["type"]} for item in commands]})


class AgentCommandResultView(APIView):
    authentication_classes = [AgentKeyAuthentication]
    permission_classes = [IsAgent]

    def post(self, request, command_id):
        body = request.data if isinstance(request.data, dict) else {}
        if body.get("status") not in {"EXECUTED", "FAILED"} or ("error" in body and not isinstance(body["error"], str)):
            return Response({"message": "Invalid command result"}, status=400)
        command = command_by_id(command_id)
        if not command or str(command.get("systemId")) != str(request.user.system.get("_id")):
            return Response({"message": "Command not found"}, status=404)
        command.update({"status": body["status"], "error": body.get("error"), "result": "Successful" if body["status"] == "EXECUTED" else "Failed", "executedAt": datetime.now(timezone.utc)})
        try:
            save_command(command)
        except Exception as error:
            log_failure(logger, "Remote command result could not be saved", error)
            return Response({"message": "Unable to update command"}, status=503)
        return Response(json_value(command))