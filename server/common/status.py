from datetime import datetime, timezone


DEFAULT_SETTINGS = {"heartbeatIntervalSeconds": 30, "offlineThresholdSeconds": 90, "cpuWarning": 80, "cpuCritical": 90, "ramWarning": 80, "ramCritical": 90, "diskWarning": 80, "diskCritical": 90, "allowedPorts": [80, 443, 3389]}


def _port_number(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def system_status(system, settings=DEFAULT_SETTINGS, now=None):
    now = now or datetime.now(timezone.utc)
    heartbeat = system.get("lastHeartbeat")
    if isinstance(heartbeat, str):
        try:
            heartbeat = datetime.fromisoformat(heartbeat.replace("Z", "+00:00"))
        except ValueError:
            heartbeat = None
    if heartbeat and heartbeat.tzinfo is None:
        heartbeat = heartbeat.replace(tzinfo=timezone.utc)
    if not heartbeat or (now - heartbeat).total_seconds() > settings.get("offlineThresholdSeconds", 90):
        return "offline"
    antivirus = system.get("antivirus") or {}
    firewall = system.get("firewall") or {}
    network = system.get("network") or {}
    if (antivirus.get("enabled") is False or any(firewall.get(profile) is False for profile in ("domain", "private", "public"))
            or network.get("status") == "CRITICAL" or network.get("connected") is False
            or any(system.get(key) is not None and system[key] >= settings.get(threshold, fallback)
                   for key, threshold, fallback in (("cpuPercent", "cpuCritical", 90), ("memoryPercent", "ramCritical", 90), ("diskPercent", "diskCritical", 90)))):
        return "critical"
    if (any(system.get(key) is not None and system[key] >= settings.get(threshold, fallback)
            for key, threshold, fallback in (("cpuPercent", "cpuWarning", 80), ("memoryPercent", "ramWarning", 80), ("diskPercent", "diskWarning", 80)))
            or antivirus.get("updated") is False
            or network.get("status") == "WARNING"
            or any(_port_number(port.get("port")) not in settings.get("allowedPorts", []) for port in system.get("listeningPorts", []))):
        return "warning"
    return "online"