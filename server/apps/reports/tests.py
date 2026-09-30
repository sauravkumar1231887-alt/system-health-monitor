from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from common.fixtures import reset_demo_data


@override_settings(DEMO_MODE=True)
class ReportApiTests(SimpleTestCase):
    def setUp(self):
        reset_demo_data()
        self.client = APIClient()
        login = self.client.post("/api/auth/login", {"email": "viewer@sentinel.local", "password": "admin123"}, format="json")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['token']}")

    def test_system_report_is_a4_landscape_single_page_pdf(self):
        response = self.client.get("/api/systems/pc-001/report/pdf?period=24h")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn(b"/Count 1", response.content)

    def test_bulk_report_is_a_zip(self):
        response = self.client.post("/api/reports/pdf", {"systemIds": ["pc-001"], "period": "7d"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/zip")

    def test_invalid_custom_date_range_returns_400(self):
        response = self.client.get("/api/systems/pc-001/report/pdf?from=bad&to=also-bad")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"message": "Invalid report period"})