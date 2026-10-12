import logging
import math
from datetime import datetime, timedelta, timezone

from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.conf import settings

from common.authentication import AgentKeyAuthentication, IsAgent
from common.fixtures import demo_collection
from common.serialization import json_value
from common.logging_utils import log_failure
from common.status import _port_number
from apps.systems.repository import get_metrics, get_settings, get_system, insert_document, list_systems, update_heartbeat


logger = logging.getLogger("monitoring.heartbeat")
ALLOWED_PLATFORMS = {"windows", "linux", "macos"}
HEARTBEAT_FIELDS = {
    "hostname": "string", "platform": "string", "ip": "string", "ipAddress": "string", "mac": "string", "os": "string", "osVersion": "string",
    "osBuildNumber": "string", "osArchitecture": "string",
    "manufacturer": "string", "model": "string", "cpu": "object", "cpuPercent": "percent", "memory": "object", "memoryPercent": "percent",
    "totalMemoryBytes": "number", "usedMemoryBytes": "number", "freeMemoryBytes": "number", "disks": "array", "diskPercent": "percent",
    "diskFreeBytes": "number", "uptime": "object", "uptimeSeconds": "number", "lastBootTime": "date", "antivirus": "object",
    "firewall": "object", "network": "object", "security": "object", "systemHealth": "object", "ups": "object", "battery": "object",
    "heartbeat": "object", "listeningPorts": "array", "agentVersion": "string",
}

PERCENT_KEYS = {"cpuPercent", "memoryPercent", "diskPercent", "usagePercent", "chargePercent", "packetLossPercent", "utilizationPercent"}
DATE_KEYS = {"collectedAt", "updatedAt", "lastUpdated", "lastBootTime"}


def valid_heartbeat(body):
    if not isinstance(body, dict) or not isinstance(body.get("hostname"), str):
        return False
    platform = body.get("platform")
    if platform is not None:
        normalized = str(platform).strip().lower()
        if normalized not in ALLOWED_PLATFORMS:
            return False
    for field, kind in HEARTBEAT_FIELDS.items():
        if field not in body:
            continue
        value = body[field]
        if value is None and field != "hostname":
            continue
        if kind == "string" and not isinstance(value, str):
            return False
        if kind in {"number", "percent"}:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                return False
            if kind == "percent" and not 0 <= value <= 100:
                return False
            if kind == "number" and value < 0:
                return False
        if kind == "object" and (not isinstance(value, dict) or not _valid_live_value(value, field)):
            return False
        if kind == "array" and (not isinstance(value, list) or any(not isinstance(item, dict) or not _valid_live_value(item, field) for item in value)):
            return False
        if kind == "date" and not isinstance(value, str):
            return False
        if kind == "date":
            try:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return False
        if field in {"network", "systemHealth", "ups", "heartbeat"} and not _valid_live_value(value, field):
            return False
    return True


def _valid_live_value(value, key, depth=0):
    if depth > 6:
        return False
    if value is None:
        return True
    if isinstance(value, bool):
        return key not in PERCENT_KEYS
    if isinstance(value, (int, float)):
        if not math.isfinite(value) or value < 0:
            return False
        if key in PERCENT_KEYS and value > 100:
            return False
        if key.lower().endswith("ms") and value > 60000:
            return False
        if key in {"uploadBytesPerSecond", "downloadBytesPerSecond"} and value > 1_000_000_000_000:
            return False
        return True
    if isinstance(value, str):
        if len(value) > 2048:
            return False
        if key in PERCENT_KEYS and value != "N/A":
            return False
        if key in DATE_KEYS:
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return False
            if parsed.tzinfo is None or parsed > datetime.now(timezone.utc) + timedelta(minutes=5):
                return False
        return True
    if isinstance(value, list):
        return len(value) <= 512 and all(_valid_live_value(item, key, depth + 1) for item in value)
    if isinstance(value, dict):
        if "port" in value:
            port = value["port"]
            if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
                return False
        if "pid" in value:
            pid = value["pid"]
            if isinstance(pid, bool) or not isinstance(pid, int) or pid < 0:
                return False
        return len(value) <= 128 and all(
            isinstance(child_key, str) and _valid_live_value(child, child_key, depth + 1)
            for child_key, child in value.items()
        )
    return False


class SystemsView(APIView):
    def get(self, request):
        try:
            return Response(json_value(list_systems()))
        except Exception as error:
            log_failure(logger, "System list query failed", error)
            return Response({"message": "Unable to load systems"}, status=503)


class PlatformSummaryView(APIView):
    def get(self, request):
        try:
            systems = list_systems()
        except Exception as error:
            log_failure(logger, "Platform summary query failed", error)
            return Response({"message": "Unable to load platform summary"}, status=503)

        summary = {
            "windows": {"total": 0, "online": 0, "offline": 0, "warning": 0, "critical": 0},
            "linux": {"total": 0, "online": 0, "offline": 0, "warning": 0, "critical": 0},
            "macos": {"total": 0, "online": 0, "offline": 0, "warning": 0, "critical": 0},
        }

        for system in systems:
            platform = str((system or {}).get("platform") or "windows").strip().lower()
            if platform.startswith("win"):
                key = "windows"
            elif platform.startswith("lin"):
                key = "linux"
            elif platform.startswith("mac") or platform == "darwin":
                key = "macos"
            else:
                key = "windows"

            stats = summary.setdefault(key, {"total": 0, "online": 0, "offline": 0, "warning": 0, "critical": 0})
            stats["total"] += 1

            state = str((system or {}).get("status") or "offline").lower()
            if state in {"online", "healthy"}:
                stats["online"] += 1
            elif state == "warning":
                stats["warning"] += 1
            elif state == "critical":
                stats["critical"] += 1
            else:
                stats["offline"] += 1

        return Response(json_value(summary))


class SystemDetailView(APIView):
    def get(self, request, system_id):
        try:
            system = get_system(system_id)
        except Exception as error:
            log_failure(logger, "System query failed", error)
            return Response({"message": "Unable to load system"}, status=503)
        if not system:
            return Response({"message": "System not found"}, status=404)
        return Response(json_value(system))


class SystemMetricsView(APIView):
    def get(self, request, system_id):
        try:
            return Response(json_value(get_metrics(system_id)))
        except Exception as error:
            log_failure(logger, "System metrics query failed", error)
            return Response({"message": "Unable to load system metrics"}, status=503)


class SystemPortsView(APIView):
    def get(self, request, system_id):
        system = get_system(system_id)
        return Response(json_value((system or {}).get("listeningPorts") or []))


def _normalize_payload(payload):
    if not isinstance(payload, dict):
        return payload
    platform = payload.get("platform")
    if isinstance(platform, str):
        payload["platform"] = platform.strip().lower()

    if payload.get("cpu") and payload.get("cpuPercent") is None:
        cpu = payload["cpu"]
        if isinstance(cpu, dict):
            payload["cpuPercent"] = cpu.get("usagePercent", cpu.get("utilizationPercent", cpu.get("percent")))
    if payload.get("memory") and payload.get("memoryPercent") is None:
        memory = payload["memory"]
        if isinstance(memory, dict):
            payload["memoryPercent"] = memory.get("usedPercent", memory.get("usagePercent", memory.get("percent")))
    if payload.get("disks") and payload.get("diskPercent") is None:
        discs = payload["disks"]
        percentages = []
        if isinstance(discs, list):
            for item in discs:
                if isinstance(item, dict):
                    value = item.get("usedPercent", item.get("usagePercent", item.get("percent")))
                    if isinstance(value, (int, float)) and math.isfinite(value):
                        percentages.append(float(value))
        if percentages:
            payload["diskPercent"] = round(sum(percentages) / len(percentages), 2)
    if payload.get("uptime") and payload.get("uptimeSeconds") is None:
        uptime = payload["uptime"]
        if isinstance(uptime, dict):
            payload["uptimeSeconds"] = uptime.get("seconds") or uptime.get("uptimeSeconds")
    if payload.get("security") and payload.get("antivirus") is None:
        payload["antivirus"] = payload["security"].get("antivirus") or payload["security"]
    if payload.get("firewall") is None and payload.get("security") and isinstance(payload["security"], dict):
        payload["firewall"] = payload["security"].get("firewall")
    if not payload.get("ip"):
        payload["ip"] = payload.get("ipAddress")
    if not payload.get("platform"):
        payload["platform"] = "windows"
    return payload


class HeartbeatView(APIView):
    authentication_classes = [AgentKeyAuthentication]
    permission_classes = [IsAgent]

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        if not valid_heartbeat(body):
            return Response({"message": "Invalid heartbeat payload"}, status=400)
        payload = {key: body.get(key) for key in HEARTBEAT_FIELDS}
        payload = _normalize_payload(payload)
        if payload.get("platform") not in ALLOWED_PLATFORMS:
            return Response({"message": "Invalid heartbeat payload"}, status=400)
        operating_system = ((payload.get("systemHealth") or {}).get("operatingSystem") or {})
        payload["os"] = payload.get("os") or operating_system.get("caption") or operating_system.get("name")
        payload["osVersion"] = payload.get("osVersion") or operating_system.get("version")
        payload["osBuildNumber"] = payload.get("osBuildNumber") or operating_system.get("buildNumber")
        payload["osArchitecture"] = payload.get("osArchitecture") or operating_system.get("architecture")
        if payload.get("lastBootTime"):
            boot_time = datetime.fromisoformat(payload["lastBootTime"].replace("Z", "+00:00"))
            payload["lastBootTime"] = boot_time.replace(tzinfo=timezone.utc) if boot_time.tzinfo is None else boot_time.astimezone(timezone.utc)
        system = request.user.system
        try:
            system = update_heartbeat(system, payload)
        except Exception as error:
            log_failure(logger, "Heartbeat could not be stored", error)
            return Response({"message": "Unable to store heartbeat"}, status=503)
        settings_data = get_settings()
        unexpected = [port for port in (system.get("listeningPorts") or []) if _port_number(port.get("port")) not in settings_data.get("allowedPorts", [])]
        if unexpected:
            alert = {"system": system.get("hostname"), "type": "Unexpected listening port", "severity": "warning", "message": f"Port {unexpected[0]['port']} is not in the allowed list.", "status": "open", "createdAt": datetime.now(timezone.utc)}
            if settings.DEMO_MODE:
                from common.fixtures import _DEMO
                alert["_id"] = __import__("uuid").uuid4().hex
                _DEMO["alerts"].insert(0, alert)
            else:
                insert_document("alerts", alert)
        return Response({
            "success": True,
            "accepted": True,
            "message": "Heartbeat received",
            "systemId": str(system["_id"]),
            "timestamp": json_value(system.get("lastHeartbeat")),
            "status": system.get("status"),
        }, status=status.HTTP_202_ACCEPTED)