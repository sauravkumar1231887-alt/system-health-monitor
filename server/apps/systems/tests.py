from datetime import datetime, timedelta, timezone

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from common import fixtures
from common.fixtures import reset_demo_data
from common.status import system_status


@override_settings(DEMO_MODE=True)
class SystemApiTests(SimpleTestCase):
    def setUp(self):
        reset_demo_data()
        self.client = APIClient()
        response = self.client.post("/api/auth/login", {"email": "admin@sentinel.local", "password": "admin123"}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['token']}")

    def test_system_list_and_metrics_keep_array_responses(self):
        systems = self.client.get("/api/systems")
        self.assertEqual(systems.status_code, 200)
        self.assertIsInstance(systems.data, list)
        metrics = self.client.get("/api/systems/pc-001/metrics")
        self.assertEqual(metrics.status_code, 200)
        self.assertEqual(metrics.data, [])

    def test_system_detail_and_missing_system_responses(self):
        found = self.client.get("/api/systems/pc-001")
        missing = self.client.get("/api/systems/not-registered")
        self.assertEqual(found.status_code, 200)
        self.assertEqual(found.data["hostname"], "ENG-WS-014")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.data, {"message": "System not found"})

    def test_heartbeat_updates_agent_system_and_records_metric(self):
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        response = agent.post("/api/heartbeat", {"hostname": "ENG-WS-014", "cpuPercent": 22.5, "memoryPercent": 54.0, "diskPercent": 50.0, "agentVersion": "1.5.0"}, format="json")
        self.assertEqual(response.status_code, 202)
        self.assertTrue(response.data["success"])
        self.assertEqual(response.data["message"], "Heartbeat received")
        self.assertTrue(response.data["timestamp"])
        self.assertEqual(response.data["systemId"], "pc-001")
        metrics = self.client.get("/api/systems/pc-001/metrics")
        self.assertEqual(len(metrics.data), 1)
        self.assertEqual(metrics.data[0]["cpuPercent"], 22.5)

    def test_invalid_heartbeat_is_rejected(self):
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        response = agent.post("/api/heartbeat", {"hostname": "ENG-WS-014", "cpuPercent": 101}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"message": "Invalid heartbeat payload"})

    def test_platform_field_is_preserved_for_multi_platform_agents(self):
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        payload = {
            "hostname": "LINUX-01",
            "platform": "linux",
            "ipAddress": "192.168.8.50",
            "os": "Ubuntu 24.04 LTS",
            "agentVersion": "2.0.0",
            "cpu": {"usagePercent": 42.5},
            "memory": {"usedPercent": 58.8},
            "disks": [{"mount": "/", "usedPercent": 61.0}],
            "uptime": {"seconds": 3600},
            "network": {"connected": True, "status": "HEALTHY"},
            "firewall": {"name": "ufw", "enabled": True, "status": "enabled"},
            "security": {"name": "Not detected", "status": "UNKNOWN"},
            "listeningPorts": [{"port": 443, "protocol": "TCP", "state": "LISTENING"}],
            "systemHealth": {"status": "HEALTHY"},
            "heartbeat": {"collectedAt": "2026-09-29T12:00:00Z"},
        }
        response = agent.post("/api/heartbeat", payload, format="json")
        self.assertEqual(response.status_code, 202)
        detail = self.client.get("/api/systems/pc-001").data
        self.assertEqual(detail["platform"], "linux")
        self.assertEqual(detail["os"], "Ubuntu 24.04 LTS")

    def test_platform_summary_endpoint_uses_real_system_counts(self):
        response = self.client.get("/api/platform-summary")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["windows"]["total"], 4)
        self.assertEqual(response.data["linux"]["total"], 0)
        self.assertEqual(response.data["macos"]["total"], 0)

    def test_browser_get_to_heartbeat_returns_json_method_error(self):
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        response = agent.get("/api/heartbeat", HTTP_ACCEPT="text/html")
        self.assertEqual(response.status_code, 406)
        self.assertEqual(response["Content-Type"], "application/json")

    def test_heartbeat_updates_network_security_and_hardware_fields(self):
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        payload = {
            "hostname": "ENG-WS-014", "ip": "10.20.4.14", "mac": "00-1A-2B-3C-4D-01",
            "os": "Windows 11 Pro", "osVersion": "10.0.26100", "manufacturer": "Dell Inc.",
            "model": "OptiPlex 7090", "cpuPercent": 24.0, "memoryPercent": 58.0,
            "totalMemoryBytes": 17179869184, "usedMemoryBytes": 9964324122,
            "freeMemoryBytes": 7215537062, "diskPercent": 46.0, "diskFreeBytes": 300000000000,
            "uptimeSeconds": 1800, "lastBootTime": "2026-09-26T10:00:00Z",
            "antivirus": {"product": "Microsoft Defender", "enabled": True, "realTimeProtection": True, "updated": True},
            "firewall": {"domain": True, "private": True, "public": True},
            "network": {"gateway": "10.20.4.1", "dns": ["10.20.0.10"], "connected": True},
            "listeningPorts": [{"port": 443, "protocol": "TCP", "state": "LISTENING"}], "agentVersion": "1.5.0",
        }
        response = agent.post("/api/heartbeat", payload, format="json")
        self.assertEqual(response.status_code, 202)
        detail = self.client.get("/api/systems/pc-001").data
        self.assertEqual(detail["network"]["gateway"], "10.20.4.1")
        self.assertTrue(detail["firewall"]["public"])
        self.assertEqual(detail["listeningPorts"][0]["port"], 443)

    def test_live_response_normalizes_agent_ip_os_memory_disk_and_antivirus(self):
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        payload = {
            "hostname": "ENG-WS-014",
            "ipAddress": "10.20.4.14",
            "agentVersion": "1.6.0",
            "systemHealth": {
                "operatingSystem": {"caption": "Windows Pro", "version": "10.0.1", "buildNumber": "26100", "architecture": "64-bit"},
                "memory": {"totalBytes": 1600, "usedBytes": 1000, "freeBytes": 600, "usagePercent": 62.5},
                "disk": {"volumes": [{"drive": "C:", "totalBytes": 1000, "usedBytes": 400, "freeBytes": 600, "usagePercent": 40}]},
                "security": {"antivirus": {"name": "Microsoft Defender", "enabled": True, "definitionsUpToDate": True}},
            },
        }
        self.assertEqual(agent.post("/api/heartbeat", payload, format="json").status_code, 202)
        live = self.client.get("/api/systems/pc-001/live").data
        self.assertEqual(live["ipAddress"], "10.20.4.14")
        self.assertEqual(live["os"], "Windows Pro")
        health = live["current"]["systemHealth"]
        self.assertEqual(health["operatingSystem"]["buildNumber"], "26100")
        self.assertEqual(health["memory"]["usedBytes"], 1000)
        self.assertEqual(health["disk"]["volumes"][0]["drive"], "C:")
        self.assertEqual(health["security"]["antivirus"]["product"], "Microsoft Defender")

    def test_live_telemetry_routes_and_history(self):
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        payload = {
            "hostname": "ENG-WS-014",
            "cpuPercent": 24,
            "memoryPercent": 58,
            "diskPercent": 46,
            "systemHealth": {"cpu": {"usagePercent": 24, "temperatureC": "N/A"}},
            "ups": {"available": False, "status": "NOT_DETECTED", "chargePercent": "N/A"},
            "network": {
                "gateway": "192.168.1.1",
                "connected": True,
                "status": "HEALTHY",
                "connectivity": {"gateway": True, "internet": True, "dns": True},
                "traffic": {"uploadBytesPerSecond": 2048, "downloadBytesPerSecond": 4096},
            },
            "heartbeat": {"collectedAt": "2026-09-29T12:00:00Z"},
        }
        accepted = agent.post("/api/heartbeat", payload, format="json")
        self.assertEqual(accepted.status_code, 202)

        live = self.client.get("/api/live-monitoring").data
        system = next(item for item in live["systems"] if item["_id"] == "pc-001")
        self.assertTrue(system["isCurrent"])
        self.assertEqual(system["current"]["network"]["status"], "HEALTHY")
        self.assertEqual(live["summary"]["upsNoData"], 4)
        self.assertEqual(self.client.get("/api/systems/pc-001/ups").data["data"]["status"], "NOT_DETECTED")
        self.assertEqual(self.client.get("/api/systems/pc-001/network").data["data"]["gateway"], "192.168.1.1")
        history = self.client.get("/api/systems/pc-001/history?period=1h").data
        self.assertEqual(history["period"], "1h")
        self.assertEqual(history["metrics"][0]["downloadBytesPerSecond"], 4096)

        for history_range in ("1h", "6h", "24h", "7d", "30d"):
            ranged_history = self.client.get(f"/api/systems/pc-001/history?range={history_range}").data
            self.assertEqual(ranged_history["range"], history_range)
            self.assertEqual(ranged_history["samples"], ranged_history["metrics"])
            self.assertTrue(ranged_history["samples"][0]["timestamp"].endswith("Z"))

    def test_live_api_does_not_present_fixture_values_as_agent_data(self):
        live = self.client.get("/api/live-monitoring").data
        system = next(item for item in live["systems"] if item["_id"] == "pc-001")
        self.assertFalse(system["isCurrent"])
        self.assertIsNone(system["current"])
        self.assertIsNone(system["lastKnown"])
        self.assertIsNone(system["lastHeartbeat"])
        self.assertEqual(live["summary"]["online"], 0)
        self.assertEqual(live["summary"]["offline"], 4)

    def test_stale_live_response_preserves_current_and_last_known(self):
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        agent.post("/api/heartbeat", {
            "hostname": "ENG-WS-014",
            "cpuPercent": 35,
            "ups": {"available": False, "status": "NOT_DETECTED"},
            "network": {"status": "WARNING"},
        }, format="json")
        fixtures._DEMO["systems"][0]["lastHeartbeat"] = datetime.now(timezone.utc) - timedelta(seconds=120)
        response = self.client.get("/api/systems/pc-001/live")
        self.assertTrue(response.data["isCurrent"])
        self.assertEqual(response.data["heartbeatStatus"], "STALE")
        self.assertIsNotNone(response.data["current"])
        self.assertEqual(response.data["lastKnown"]["network"]["status"], "WARNING")

    def test_invalid_nested_measurement_and_history_period_are_rejected(self):
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        invalid_measurements = [
            {"network": {"traffic": {"uploadBytesPerSecond": -1}}},
            {"network": {"latency": {"gatewayMs": 60001}}},
            {"heartbeat": {"collectedAt": "2999-01-01T00:00:00Z"}},
        ]
        for measurement in invalid_measurements:
            response = agent.post("/api/heartbeat", {
                "hostname": "ENG-WS-014",
                **measurement,
            }, format="json")
            self.assertEqual(response.status_code, 400)
        history = self.client.get("/api/systems/pc-001/history?period=all")
        self.assertEqual(history.status_code, 400)

    def test_status_preserves_critical_and_offline_thresholds(self):
        system = {"lastHeartbeat": "2026-09-26T11:58:00Z", "antivirus": {"enabled": True, "updated": True}, "firewall": {"domain": True, "private": True, "public": True}, "cpuPercent": 90}
        now = datetime.fromisoformat("2026-09-26T12:00:00+00:00")
        self.assertEqual(system_status(system, now=now), "critical")
        system["lastHeartbeat"] = "2026-09-26T11:59:30Z"
        self.assertEqual(system_status(system, now=now), "critical")
        system["lastHeartbeat"] = "2026-09-26T11:54:59Z"
        self.assertEqual(system_status(system, now=now), "offline")
        system.update({"lastHeartbeat": "2026-09-26T11:58:29Z", "cpuPercent": 20})
        self.assertEqual(system_status(system, now=now), "stale")

    def test_measured_network_health_affects_system_severity(self):
        system = {"lastHeartbeat": "2026-09-26T11:59:30Z", "network": {"status": "WARNING"}}
        now = datetime.fromisoformat("2026-09-26T12:00:00+00:00")
        self.assertEqual(system_status(system, now=now), "warning")
        system["network"]["status"] = "CRITICAL"
        self.assertEqual(system_status(system, now=now), "critical")