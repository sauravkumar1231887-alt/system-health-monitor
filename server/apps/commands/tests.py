from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from common.fixtures import reset_demo_data


@override_settings(DEMO_MODE=True)
class CommandApiTests(SimpleTestCase):
    def setUp(self):
        reset_demo_data()

    def token_for(self, email):
        response = APIClient().post("/api/auth/login", {"email": email, "password": "admin123"}, format="json")
        return response.data["token"]

    def test_administrator_can_queue_only_supported_actions(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token_for('admin@sentinel.local')}")
        response = client.post("/api/systems/pc-001/actions/restart", {}, format="json")
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data["type"], "RESTART")

    def test_viewer_cannot_queue_remote_commands(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token_for('viewer@sentinel.local')}")
        response = client.post("/api/systems/pc-001/actions/shutdown", {}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data, {"message": "Administrator role required"})

    def test_agent_polls_only_its_own_pending_command(self):
        admin = APIClient()
        admin.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token_for('admin@sentinel.local')}")
        admin.post("/api/systems/pc-001/actions/restart", {}, format="json")
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        response = agent.post("/api/agent/commands/poll", {}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["commands"]), 1)
        self.assertEqual(response.data["commands"][0]["type"], "RESTART")

    def test_agent_can_report_command_result(self):
        admin = APIClient()
        admin.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token_for('admin@sentinel.local')}")
        queued = admin.post("/api/systems/pc-001/actions/shutdown", {}, format="json")
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        response = agent.post(f"/api/agent/commands/{queued.data['_id']}/result", {"status": "EXECUTED"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["result"], "Successful")

    def test_agent_cannot_report_for_another_system(self):
        admin = APIClient()
        admin.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token_for('admin@sentinel.local')}")
        queued = admin.post("/api/systems/pc-002/actions/restart", {}, format="json")
        agent = APIClient()
        agent.credentials(HTTP_X_AGENT_KEY="demo-agent-pc-001")
        response = agent.post(f"/api/agent/commands/{queued.data['_id']}/result", {"status": "EXECUTED"}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_alerts_can_be_read_and_updated(self):
        viewer = APIClient()
        viewer.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token_for('viewer@sentinel.local')}")
        alerts = viewer.get("/api/alerts")
        self.assertEqual(alerts.status_code, 200)
        self.assertEqual(len(alerts.data), 3)
        updated = viewer.put("/api/alerts/ALT-1048", {"status": "resolved"}, format="json")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["status"], "resolved")

    def test_settings_and_audit_logs_keep_existing_shapes(self):
        admin = APIClient()
        admin.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token_for('admin@sentinel.local')}")
        settings_response = admin.get("/api/settings")
        audit_response = admin.get("/api/audit-logs")
        self.assertEqual(settings_response.status_code, 200)
        self.assertEqual(settings_response.data["offlineThresholdSeconds"], 90)
        self.assertEqual(audit_response.status_code, 200)
        self.assertIsInstance(audit_response.data, list)