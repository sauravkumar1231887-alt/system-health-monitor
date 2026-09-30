import logging
from datetime import datetime, timedelta, timezone

from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.systems.repository import get_history, get_settings, get_system, list_systems
from common.database import collection
from common.fixtures import demo_collection
from common.logging_utils import log_failure
from common.serialization import json_value


logger = logging.getLogger("monitoring.settings")


def _live_record(system):
    has_agent_sample = bool(system.get("liveMonitoringAt"))
    system_status = system.get("status", "offline")
    if settings.DEMO_MODE and not has_agent_sample:
        system_status = "offline"
    is_current = has_agent_sample and system_status != "offline"
    last_known = None
    if has_agent_sample:
        last_known = {
            "systemHealth": system.get("systemHealth") or {
                "cpuPercent": system.get("cpuPercent"),
                "memoryPercent": system.get("memoryPercent"),
                "diskPercent": system.get("diskPercent"),
                "totalMemoryBytes": system.get("totalMemoryBytes"),
                "usedMemoryBytes": system.get("usedMemoryBytes"),
                "freeMemoryBytes": system.get("freeMemoryBytes"),
                "diskFreeBytes": system.get("diskFreeBytes"),
                "uptimeSeconds": system.get("uptimeSeconds"),
            },
            "ups": system.get("ups"),
            "network": system.get("network"),
        }
    return {
        "_id": system.get("_id"),
        "hostname": system.get("hostname"),
        "ip": system.get("ip"),
        "os": system.get("os"),
        "status": system_status,
        "lastHeartbeat": system.get("lastHeartbeat") if has_agent_sample else None,
        "lastUpdated": system.get("liveMonitoringAt"),
        "isCurrent": is_current,
        "current": last_known if is_current else None,
        "lastKnown": last_known,
    }


def _period_range(period):
    durations = {"1h": timedelta(hours=1), "6h": timedelta(hours=6), "24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
    duration = durations.get(period)
    if not duration:
        return None
    end = datetime.now(timezone.utc)
    seconds = max(30, int(duration.total_seconds() / 1200 / 30) * 30)
    return end - duration, end, seconds


class SettingsView(APIView):
    def get(self, request):
        try:
            return Response(json_value(get_settings()))
        except Exception as error:
            log_failure(logger, "Settings query failed", error)
            return Response({"message": "Unable to load settings"}, status=503)


class AuditLogsView(APIView):
    def get(self, request):
        try:
            logs = demo_collection("auditlogs") if settings.DEMO_MODE else [item for item in collection("auditlogs").find({}).sort("timestamp", -1)]
            return Response(json_value(logs))
        except Exception as error:
            log_failure(logger, "Audit log query failed", error)
            return Response({"message": "Unable to load audit logs"}, status=503)


class LiveMonitoringView(APIView):
    def get(self, request):
        try:
            records = [_live_record(system) for system in list_systems()]
            current = [record for record in records if record["isCurrent"]]
            online = sum(record["status"] == "online" for record in records)
            ups_states = [((record["current"] or {}).get("ups") or {}).get("status") for record in current]
            network_states = [((record["current"] or {}).get("network") or {}).get("status", "UNKNOWN") for record in current]
            return Response({
                "systems": records,
                "summary": {
                    "total": len(records),
                    "online": online,
                    "warning": sum(record["status"] == "warning" for record in records),
                    "critical": sum(record["status"] == "critical" for record in records),
                    "offline": sum(record["status"] == "offline" for record in records),
                    "upsOnline": sum(value == "ONLINE" for value in ups_states),
                    "upsOnBattery": sum(value in {"ON_BATTERY", "LOW_BATTERY"} for value in ups_states),
                    "upsNoData": len(records) - sum(bool(((record["current"] or {}).get("ups") or {}).get("available")) for record in records),
                    "networkHealthy": sum(value == "HEALTHY" for value in network_states),
                    "networkWarning": sum(value == "WARNING" for value in network_states),
                    "networkCritical": sum(value == "CRITICAL" for value in network_states),
                    "networkOffline": sum(record["status"] == "offline" for record in records),
                },
            })
        except Exception as error:
            log_failure(logger, "Live monitoring query failed", error)
            return Response({"message": "Unable to load live monitoring"}, status=503)


class SystemLiveView(APIView):
    def get(self, request, system_id):
        try:
            system = get_system(system_id)
            if not system:
                return Response({"message": "System not found"}, status=404)
            return Response(_live_record(system))
        except Exception as error:
            log_failure(logger, "System live query failed", error)
            return Response({"message": "Unable to load live monitoring"}, status=503)


class SystemTelemetrySliceView(APIView):
    section = None

    def get(self, request, system_id):
        try:
            system = get_system(system_id)
            if not system:
                return Response({"message": "System not found"}, status=404)
            record = _live_record(system)
            latest = record["current"] or {}
            last_known = record["lastKnown"] or {}
            return Response({
                "systemId": system_id,
                "status": record["status"],
                "isCurrent": record["isCurrent"],
                "data": latest.get(self.section),
                "lastKnown": last_known.get(self.section),
                "lastUpdated": record["lastUpdated"],
            })
        except Exception as error:
            log_failure(logger, f"System {self.section} query failed", error)
            return Response({"message": f"Unable to load {self.section} data"}, status=503)


class SystemHealthView(SystemTelemetrySliceView):
    section = "systemHealth"


class SystemNetworkView(SystemTelemetrySliceView):
    section = "network"


class SystemUpsView(SystemTelemetrySliceView):
    section = "ups"


class SystemHistoryView(APIView):
    def get(self, request, system_id):
        period = request.query_params.get("period", "24h")
        date_range = _period_range(period)
        if not date_range:
            return Response({"message": "Period must be 1h, 6h, 24h, 7d, or 30d"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            if not get_system(system_id):
                return Response({"message": "System not found"}, status=404)
            start, end, bucket_seconds = date_range
            metrics = get_history(system_id, start, end, bucket_seconds)
            return Response({"period": period, "metrics": metrics})
        except Exception as error:
            log_failure(logger, "System history query failed", error)
            return Response({"message": "Unable to load system history"}, status=503)