import logging
import zipfile
from datetime import datetime, timedelta, timezone
from io import BytesIO

from django.conf import settings
from django.http import HttpResponse
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.reports.pdf import generate_health_pdf
from apps.systems.repository import get_metrics, get_settings, get_system, list_named
from common.logging_utils import log_failure


logger = logging.getLogger("reports")


def parse_date(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def report_window(query):
    now = datetime.now(timezone.utc)
    period_days = {"7d": 7, "30d": 30}.get(query.get("period"), 1)
    start = parse_date(query.get("from")) or now - timedelta(days=period_days)
    end = parse_date(query.get("to")) or now
    return start, end


def system_report_data(system, start, end):
    metrics = get_metrics(system["_id"], limit=100000, start=start, end=end)
    alerts = [item for item in list_named("alerts") if (str(item.get("systemId")) == str(system["_id"]) or item.get("system") == system.get("hostname")) and start <= _date(item.get("createdAt")) <= end]
    commands = [item for item in list_named("commands") if str(item.get("systemId")) == str(system["_id"]) and start <= _date(item.get("createdAt")) <= end]
    return metrics, alerts, commands


def _date(value):
    parsed = parse_date(value) if isinstance(value, str) else value
    if isinstance(parsed, datetime):
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return datetime.min.replace(tzinfo=timezone.utc)


def make_pdf(system, start, end):
    metrics, alerts, commands = system_report_data(system, start, end)
    return generate_health_pdf(system, metrics, alerts, commands, get_settings(), start, end, settings.ORGANIZATION_NAME)


class SystemReportView(APIView):
    def get(self, request, system_id):
        system = get_system(system_id)
        if not system:
            return Response({"message": "System not found"}, status=404)
        start, end = report_window(request.query_params)
        if any(key in request.query_params and parse_date(request.query_params.get(key)) is None for key in ("from", "to")) or start >= end:
            return Response({"message": "Invalid report period"}, status=400)
        try:
            pdf = make_pdf(system, start, end)
        except Exception as error:
            log_failure(logger, "PDF report generation failed", error)
            return Response({"message": "Unable to generate the health report"}, status=500)
        filename = f"SystemHealth_{system.get('hostname', 'system')}_{datetime.now(timezone.utc).date().isoformat()}.pdf"
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class BulkReportView(APIView):
    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        ids = body.get("systemIds")
        period = body.get("period", "24h")
        valid = isinstance(ids, list) and 1 <= len(ids) <= 60 and all(isinstance(value, str) for value in ids)
        valid = valid and period in {"24h", "7d", "30d", "custom"}
        valid = valid and all(key not in body or isinstance(body[key], str) for key in ("from", "to"))
        if not valid:
            return Response({"message": "At least one system is required"}, status=400)
        start, end = report_window(body)
        if any(key in body and parse_date(body.get(key)) is None for key in ("from", "to")) or start >= end:
            return Response({"message": "Invalid report period"}, status=400)
        selected = [system for system in (get_system(item) for item in ids) if system]
        if not selected:
            return Response({"message": "No systems found"}, status=404)
        try:
            archive_buffer = BytesIO()
            with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
                for system in selected:
                    archive.writestr(f"{system.get('hostname', 'system')}.pdf", make_pdf(system, start, end))
            filename = f"System-Health-Reports-{datetime.now(timezone.utc).date().isoformat()}.zip"
            response = HttpResponse(archive_buffer.getvalue(), content_type="application/zip")
            response["Content-Disposition"] = f'attachment; filename="{filename}"'
            return response
        except Exception as error:
            log_failure(logger, "Bulk PDF report generation failed", error)
            return Response({"message": "Unable to generate the selected reports"}, status=500)