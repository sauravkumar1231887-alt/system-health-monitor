import logging

from rest_framework.response import Response
from rest_framework.views import APIView

from common.serialization import json_value
from common.logging_utils import log_failure
from apps.systems.repository import get_alert, list_named, save_alert


logger = logging.getLogger("monitoring.alerts")


class AlertsView(APIView):
    def get(self, request):
        try:
            return Response(json_value(list_named("alerts")))
        except Exception as error:
            log_failure(logger, "Alert query failed", error)
            return Response({"message": "Unable to load alerts"}, status=503)


class AlertDetailView(APIView):
    def put(self, request, alert_id):
        alert = get_alert(alert_id)
        if not alert:
            return Response({"message": "Alert not found"}, status=404)
        body = request.data if isinstance(request.data, dict) else {}
        if body.get("status"):
            alert["status"] = body["status"]
        try:
            save_alert(alert)
        except Exception as error:
            log_failure(logger, "Alert update failed", error)
            return Response({"message": "Unable to update alert"}, status=503)
        return Response(json_value(alert))