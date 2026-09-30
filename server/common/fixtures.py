from copy import deepcopy
from datetime import datetime, timedelta, timezone


def demo_data():
    now = datetime.now(timezone.utc)
    systems = [
        {"_id": "pc-001", "hostname": "ENG-WS-014", "ip": "10.20.4.14", "mac": "00-1A-2B-3C-4D-01", "os": "Windows 11 Pro", "osVersion": "10.0.26100", "manufacturer": "Dell Inc.", "model": "OptiPlex 7090", "cpuPercent": 34, "memoryPercent": 61, "totalMemoryBytes": 17179869184, "usedMemoryBytes": 10428717056, "freeMemoryBytes": 6751152128, "diskPercent": 68, "diskFreeBytes": 256000000000, "uptimeSeconds": 86400, "lastBootTime": now - timedelta(days=1), "antivirus": {"product": "Microsoft Defender", "enabled": True, "realTimeProtection": True, "updated": True, "definitionAgeDays": 1}, "firewall": {"domain": True, "private": True, "public": True}, "network": {"gateway": "10.20.4.1", "dns": ["10.20.0.10"], "connected": True}, "listeningPorts": [{"port": 443, "protocol": "TCP", "state": "LISTENING"}], "ports": 4, "lastHeartbeat": now - timedelta(seconds=20), "status": "online", "agentVersion": "1.5.0", "agentToken": "demo-agent-pc-001"},
        {"_id": "pc-002", "hostname": "FIN-LT-003", "ip": "10.20.8.23", "mac": "00-1A-2B-3C-4D-02", "os": "Windows 10 Enterprise", "osVersion": "10.0.19045", "manufacturer": "Lenovo", "model": "ThinkPad T14", "cpuPercent": 86, "memoryPercent": 78, "totalMemoryBytes": 17179869184, "usedMemoryBytes": 13400276992, "freeMemoryBytes": 3779592192, "diskPercent": 72, "diskFreeBytes": 180000000000, "uptimeSeconds": 172800, "lastBootTime": now - timedelta(days=2), "antivirus": {"product": "Microsoft Defender", "enabled": True, "realTimeProtection": True, "updated": False, "definitionAgeDays": 9}, "firewall": {"domain": True, "private": True, "public": False}, "network": {"gateway": "10.20.8.1", "dns": ["10.20.0.10"], "connected": True}, "listeningPorts": [{"port": 3389, "protocol": "TCP", "state": "LISTENING"}], "ports": 6, "lastHeartbeat": now - timedelta(seconds=40), "status": "warning", "agentVersion": "1.4.2", "agentToken": "demo-agent-pc-002"},
        {"_id": "pc-003", "hostname": "OPS-SRV-002", "ip": "10.20.1.8", "mac": "00-1A-2B-3C-4D-03", "os": "Windows Server 2022", "osVersion": "10.0.20348", "manufacturer": "HPE", "model": "ProLiant DL360", "cpuPercent": 12, "memoryPercent": 43, "totalMemoryBytes": 34359738368, "usedMemoryBytes": 14774624256, "freeMemoryBytes": 19585014184, "diskPercent": 49, "diskFreeBytes": 512000000000, "uptimeSeconds": 840, "lastBootTime": now - timedelta(minutes=14), "antivirus": {"product": "CrowdStrike Falcon", "enabled": True, "realTimeProtection": True, "updated": True, "definitionAgeDays": 1}, "firewall": {"domain": True, "private": True, "public": True}, "network": {"gateway": "10.20.1.1", "dns": ["10.20.0.10"], "connected": True}, "listeningPorts": [{"port": 445, "protocol": "TCP", "state": "LISTENING"}], "ports": 3, "lastHeartbeat": now - timedelta(seconds=120), "status": "offline", "agentVersion": "1.3.9", "agentToken": "demo-agent-pc-003"},
        {"_id": "pc-004", "hostname": "MKT-LT-019", "ip": "10.20.6.41", "mac": "00-1A-2B-3C-4D-04", "os": "Windows 11 Pro", "osVersion": "10.0.26100", "manufacturer": "HP", "model": "EliteBook 840", "cpuPercent": 92, "memoryPercent": 91, "totalMemoryBytes": 17179869184, "usedMemoryBytes": 15602810880, "freeMemoryBytes": 1577058304, "diskPercent": 88, "diskFreeBytes": 64000000000, "uptimeSeconds": 3600, "lastBootTime": now - timedelta(hours=1), "antivirus": {"product": "Microsoft Defender", "enabled": False, "realTimeProtection": False, "updated": False, "definitionAgeDays": 30}, "firewall": {"domain": True, "private": False, "public": True}, "network": {"gateway": "10.20.6.1", "dns": ["10.20.0.10"], "connected": True}, "listeningPorts": [{"port": 445, "protocol": "TCP", "state": "LISTENING"}], "ports": 8, "lastHeartbeat": now - timedelta(seconds=20), "status": "critical", "agentVersion": "1.4.2", "agentToken": "demo-agent-pc-004"},
    ]
    alerts = [
        {"_id": "ALT-1048", "system": "MKT-LT-019", "type": "Antivirus disabled", "severity": "critical", "message": "Real-time protection is disabled.", "status": "open", "createdAt": now},
        {"_id": "ALT-1047", "system": "FIN-LT-003", "type": "Firewall profile", "severity": "high", "message": "Public firewall profile is disabled.", "status": "open", "createdAt": now},
        {"_id": "ALT-1046", "system": "OPS-SRV-002", "type": "Heartbeat missed", "severity": "critical", "message": "No heartbeat received for 2 minutes.", "status": "open", "createdAt": now},
    ]
    settings = {"heartbeatIntervalSeconds": 30, "offlineThresholdSeconds": 90, "cpuWarning": 80, "cpuCritical": 90, "ramWarning": 80, "ramCritical": 90, "diskWarning": 80, "diskCritical": 90, "allowedPorts": [80, 443, 3389]}
    return {"systems": systems, "alerts": alerts, "commands": [], "auditlogs": [], "systemmetrics": [], "settings": settings}


_DEMO = demo_data()


def demo_collection(name):
    return deepcopy(_DEMO[name])


def reset_demo_data():
    global _DEMO
    _DEMO = demo_data()