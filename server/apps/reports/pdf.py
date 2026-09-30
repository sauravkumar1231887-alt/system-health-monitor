from io import BytesIO
from datetime import datetime
import math

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas


PAGE_WIDTH, PAGE_HEIGHT = landscape(A4)
INK = colors.HexColor("#172233")
MUTED = colors.HexColor("#65748a")
LINE = colors.HexColor("#dfe6ee")
BLUE = colors.HexColor("#3677ff")


def _value(value):
    return "N/A" if value is None or value == "" else str(value)


def _section(pdf, title, x, y, width):
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(x, y, title.upper())
    pdf.setStrokeColor(LINE)
    pdf.line(x, y - 4, x + width, y - 4)


def _label(pdf, label, value, x, y, width=120):
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica-Bold", 5.8)
    pdf.drawString(x, y, label.upper())
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica", 7)
    pdf.drawString(x, y - 9, _value(value)[:max(1, int(width / 4))])


def _table(pdf, headers, rows, x, y, widths, max_rows=8):
    row_h = 12
    pdf.setFillColor(colors.HexColor("#f4f7fb"))
    pdf.rect(x, y - row_h + 2, sum(widths), row_h, fill=1, stroke=0)
    cursor = x
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica-Bold", 5.8)
    for cell, width in zip(headers, widths):
        pdf.drawString(cursor + 2, y - 6, _value(cell)[:22])
        cursor += width
    visible = rows[:max_rows] or [["N/A"] * len(headers)]
    for row_index, row in enumerate(visible):
        cursor = x
        row_y = y - row_h * (row_index + 1) - 6
        pdf.setFillColor(INK)
        pdf.setFont("Helvetica", 5.7)
        for index, (cell, width) in enumerate(zip(row, widths)):
            pdf.drawString(cursor + 2, row_y, _value(cell)[:max(1, int(width / 3.3))])
            cursor += width
    if len(rows) > max_rows:
        pdf.setFillColor(MUTED)
        pdf.setFont("Helvetica-Oblique", 5.5)
        pdf.drawString(x, y - row_h * (max_rows + 1) - 4, f"+ {len(rows) - max_rows} additional records")


def _bytes(value):
    try:
        return f"{float(value) / 1073741824:.1f} GB"
    except (TypeError, ValueError):
        return "N/A"


def _chart(pdf, title, values, x, y, width, height, color):
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica-Bold", 5.8)
    pdf.drawString(x, y, title.upper())
    left, bottom, plot_width, plot_height = x, y - height + 3, width, height - 10
    pdf.setStrokeColor(LINE)
    pdf.line(left, bottom, left + plot_width, bottom)
    values = [float(value) for value in reversed(values) if isinstance(value, (int, float))]
    if not values:
        pdf.setFont("Helvetica", 5.5)
        pdf.drawString(left + 3, bottom + 3, "Historical data unavailable")
        return
    pdf.setStrokeColor(color)
    pdf.setLineWidth(1)
    points = [(left + index * plot_width / max(len(values) - 1, 1), bottom + max(0, min(value, 100)) * plot_height / 100) for index, value in enumerate(values)]
    if len(points) == 1:
        pdf.circle(points[0][0], points[0][1], 1.5, fill=1, stroke=0)
    else:
        path = pdf.beginPath()
        path.moveTo(*points[0])
        for point in points[1:]:
            path.lineTo(*point)
        pdf.drawPath(path, stroke=1, fill=0)
    pdf.setLineWidth(1)


def _overall_status(system, settings):
    checks = []
    thresholds = (("cpuPercent", "cpuWarning", "cpuCritical", 80, 90), ("memoryPercent", "ramWarning", "ramCritical", 80, 90), ("diskPercent", "diskWarning", "diskCritical", 80, 90))
    for field, warning_key, critical_key, warning, critical in thresholds:
        value = system.get(field)
        checks.append("UNKNOWN" if value is None else "CRITICAL" if value >= settings.get(critical_key, critical) else "WARNING" if value >= settings.get(warning_key, warning) else "HEALTHY")
    antivirus = system.get("antivirus") or {}
    checks.append("UNKNOWN" if antivirus.get("enabled") is None else "HEALTHY" if antivirus["enabled"] else "CRITICAL")
    firewall = system.get("firewall") or {}
    checks.extend("UNKNOWN" if firewall.get(profile) is None else "HEALTHY" if firewall[profile] else "WARNING" for profile in ("domain", "private", "public"))
    connected = (system.get("network") or {}).get("connected")
    checks.append("UNKNOWN" if connected is None else "HEALTHY" if connected else "CRITICAL")
    if system.get("status") == "offline":
        checks.append("OFFLINE")
    if "CRITICAL" in checks or "OFFLINE" in checks:
        return "CRITICAL"
    if "WARNING" in checks:
        return "WARNING"
    return "UNKNOWN" if "UNKNOWN" in checks else "HEALTHY"


def generate_health_pdf(system, metrics, alerts, commands, settings, start, end, organization):
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=landscape(A4), pageCompression=1)
    pdf.setTitle(f"System Health Report - {system.get('hostname', 'Unknown')}")
    pdf.setFillColor(BLUE)
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawString(22, PAGE_HEIGHT - 22, organization.upper())
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(22, PAGE_HEIGHT - 42, "SYSTEM HEALTH REPORT")
    _label(pdf, "Identity", " | ".join(_value(system.get(key)) for key in ("hostname", "ip", "os")), 270, PAGE_HEIGHT - 25, 360)
    _label(pdf, "Overall Status", _overall_status(system, settings), 650, PAGE_HEIGHT - 25, 130)
    _label(pdf, "Generated", datetime.now().astimezone().strftime("%d %b %Y %H:%M"), 270, PAGE_HEIGHT - 47, 170)
    _label(pdf, "Report Period", f"{start.isoformat()} - {end.isoformat()}", 460, PAGE_HEIGHT - 47, 300)

    _section(pdf, "Health Summary", 22, PAGE_HEIGHT - 72, 798)
    values = [("CPU", system.get("cpuPercent")), ("Memory", system.get("memoryPercent")), ("Disk", system.get("diskPercent"))]
    for index, (label, value) in enumerate(values):
        _label(pdf, label, f"{_value(value)}%", 24 + index * 100, PAGE_HEIGHT - 91, 90)
    _label(pdf, "Antivirus", (system.get("antivirus") or {}).get("enabled"), 324, PAGE_HEIGHT - 91, 90)
    _label(pdf, "Network", (system.get("network") or {}).get("connected"), 424, PAGE_HEIGHT - 91, 90)
    _label(pdf, "Agent", system.get("status"), 524, PAGE_HEIGHT - 91, 90)

    _section(pdf, "System Information", 22, PAGE_HEIGHT - 125, 798)
    info = [("Hostname", "hostname"), ("IP Address", "ip"), ("MAC Address", "mac"), ("OS", "os"), ("OS Version", "osVersion"), ("Manufacturer", "manufacturer"), ("Model", "model"), ("Agent Version", "agentVersion"), ("Uptime (seconds)", "uptimeSeconds"), ("Last Boot", "lastBootTime"), ("Last Heartbeat", "lastHeartbeat")]
    for index, (label, key) in enumerate(info):
        _label(pdf, label, system.get(key), 22 + index % 6 * 133, PAGE_HEIGHT - 143 - (index // 6) * 20, 125)

    left, middle, right = 22, 288, 554
    _section(pdf, "Resource Health", left, PAGE_HEIGHT - 193, 255)
    cpu_values = [item.get("cpuPercent") for item in metrics if item.get("cpuPercent") is not None]
    memory_values = [item.get("memoryPercent") for item in metrics if item.get("memoryPercent") is not None]
    average = lambda values: round(sum(values) / len(values), 1) if values else None
    resource_rows = [
        ["CPU current / avg", system.get("cpuPercent"), average(cpu_values)],
        ["CPU min / max", min(cpu_values) if cpu_values else None, max(cpu_values) if cpu_values else None],
        ["Memory usage", system.get("memoryPercent"), ""],
        ["Memory total", _bytes(system.get("totalMemoryBytes")), ""],
        ["Memory used / free", _bytes(system.get("usedMemoryBytes")), _bytes(system.get("freeMemoryBytes"))],
        ["Disk usage", system.get("diskPercent"), ""],
        ["Disk free", _bytes(system.get("diskFreeBytes")), ""],
    ]
    _table(pdf, ["Metric", "Current / Min", "Average / Max"], resource_rows, left, PAGE_HEIGHT - 210, [105, 75, 75], 7)
    _chart(pdf, "CPU History", cpu_values, left, PAGE_HEIGHT - 310, 120, 39, BLUE)
    _chart(pdf, "Memory History", memory_values, left + 132, PAGE_HEIGHT - 310, 120, 39, colors.HexColor("#1d9a70"))
    _section(pdf, "Security", middle, PAGE_HEIGHT - 193, 255)
    antivirus = system.get("antivirus") or {}
    firewall = system.get("firewall") or {}
    security = [["Antivirus product", antivirus.get("product"), ""], ["Protection enabled", antivirus.get("enabled"), ""], ["Real-time protection", antivirus.get("realTimeProtection"), ""], ["Definitions updated", antivirus.get("updated"), ""], ["Definition age (days)", antivirus.get("definitionAgeDays"), ""], ["Last signature update", antivirus.get("lastUpdate"), ""], *[[f"Firewall {key}", value, ""] for key, value in firewall.items()]]
    _table(pdf, ["Security control", "Value", "Status"], security, middle, PAGE_HEIGHT - 210, [115, 80, 60], 8)
    _section(pdf, "Network & Ports", right, PAGE_HEIGHT - 193, 265)
    ports = [[item.get("protocol"), item.get("localAddress") or item.get("address"), item.get("port"), item.get("state"), item.get("process") or item.get("processName"), item.get("pid") or item.get("owningProcess")] for item in (system.get("listeningPorts") or [])]
    _table(pdf, ["Proto", "Local", "Port", "State", "Process", "PID"], ports, right, PAGE_HEIGHT - 210, [38, 55, 32, 48, 62, 30], 5)
    network = system.get("network") or {}
    _label(pdf, "Internet / Network", network.get("connected"), right, PAGE_HEIGHT - 278, 125)
    _label(pdf, "Gateway", network.get("gateway"), right + 135, PAGE_HEIGHT - 278, 125)
    checks = system.get("requiredPortResults") or []
    check_rows = [[item.get("name") or item.get("host"), item.get("port"), item.get("protocol"), item.get("result") or item.get("status"), item.get("latency") or item.get("response")] for item in checks]
    _table(pdf, ["Required destination", "Port", "Proto", "Result", "Latency"], check_rows, right, PAGE_HEIGHT - 305, [88, 34, 40, 57, 46], 3)

    _section(pdf, "Alerts", 22, PAGE_HEIGHT - 385, 390)
    alert_rows = [[item.get("createdAt"), item.get("severity"), item.get("type"), item.get("status")] for item in alerts]
    _table(pdf, ["Time", "Severity", "Alert", "Status"], alert_rows, 22, PAGE_HEIGHT - 402, [85, 65, 175, 65], 5)
    _section(pdf, "Remote Commands", 422, PAGE_HEIGHT - 385, 398)
    command_rows = [[item.get("createdAt"), item.get("type"), item.get("requestedBy"), item.get("result") or item.get("status"), item.get("executedAt")] for item in commands]
    _table(pdf, ["Time", "Action", "Requested By", "Status", "Completed"], command_rows, 422, PAGE_HEIGHT - 402, [75, 60, 115, 65, 83], 5)

    _section(pdf, "Availability & Historical Data", 22, 112, 798)
    expected = max(0, math.ceil((end - start).total_seconds() / (settings.get("heartbeatIntervalSeconds", 30) or 30)))
    missed = max(0, expected - len(metrics))
    availability = f"{(len(metrics) / expected * 100):.1f}%" if expected else "N/A"
    _label(pdf, "First Seen", system.get("createdAt"), 22, 94, 130)
    _label(pdf, "Last Seen", system.get("lastHeartbeat"), 160, 94, 130)
    _label(pdf, "Heartbeats / Expected", f"{len(metrics)} / {expected}", 300, 94, 140)
    _label(pdf, "Missed / Availability", f"{missed} / {availability}", 450, 94, 140)
    _label(pdf, "CPU / Memory Points", f"{len(cpu_values)} / {len(memory_values)}", 600, 94, 140)
    pdf.setStrokeColor(LINE)
    pdf.line(22, 28, 820, 28)
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 6)
    pdf.drawRightString(820, 17, f"System Monitoring Health | Generated {datetime.now().astimezone().isoformat(timespec='minutes')}")
    pdf.showPage()
    pdf.save()
    stream.seek(0)
    return stream.getvalue()