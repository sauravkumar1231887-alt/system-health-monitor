import bcrypt
from django.core.management import call_command
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient
from io import StringIO
from unittest.mock import patch

from common.fixtures import reset_demo_data


@override_settings(DEMO_MODE=True)
class AuthenticationApiTests(SimpleTestCase):
    def setUp(self):
        reset_demo_data()
        self.client = APIClient()

    def test_login_returns_existing_token_contract(self):
        response = self.client.post("/api/auth/login", {"email": "admin@sentinel.local", "password": "admin123"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["token"])
        self.assertEqual(response.data["user"], {"name": "Alex Morgan", "role": "Administrator"})

    def test_login_validation_error_matches_api_contract(self):
        response = self.client.post("/api/auth/login", {"email": "invalid", "password": "short"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"message": "Valid email and password are required"})

    def test_wrong_credentials_keep_401_response(self):
        response = self.client.post("/api/auth/login", {"email": "admin@sentinel.local", "password": "wrong-password"}, format="json")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data, {"message": "Invalid credentials"})

    def test_protected_routes_require_token(self):
        response = self.client.get("/api/systems")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data, {"message": "Authentication required"})

    def test_health_reports_demo_mode_without_claiming_mongodb_connected(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["backend"], "healthy")
        self.assertEqual(response.data["database"], "demo")
        self.assertTrue(response.data["timestamp"])

    @override_settings(DEMO_MODE=False)
    @patch("apps.authentication.views.collection")
    def test_health_reports_mongodb_connectivity(self, mocked_collection):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["backend"], "healthy")
        self.assertEqual(response.data["database"], "connected")
        self.assertTrue(response.data["timestamp"])
        mocked_collection.return_value.database.command.assert_called_once_with("ping")

    @override_settings(DEMO_MODE=False)
    @patch("apps.authentication.views.collection")
    def test_health_returns_service_unavailable_when_mongodb_is_down(self, mocked_collection):
        mocked_collection.return_value.database.command.side_effect = RuntimeError("unavailable")
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["backend"], "healthy")
        self.assertEqual(response.data["database"], "disconnected")
        self.assertTrue(response.data["timestamp"])

    @override_settings(DEMO_MODE=False)
    @patch("apps.authentication.views.collection")
    def test_login_returns_service_unavailable_when_mongodb_is_down(self, mocked_collection):
        mocked_collection.return_value.find_one.side_effect = RuntimeError("unavailable")
        response = self.client.post(
            "/api/auth/login",
            {"email": "admin@example.com", "password": "valid-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data, {"message": "Authentication service unavailable"})

    @patch("apps.authentication.management.commands.create_dashboard_user.getpass.getpass")
    @patch("apps.authentication.management.commands.create_dashboard_user.collection")
    def test_create_dashboard_user_stores_only_a_bcrypt_hash(self, mocked_collection, mocked_getpass):
        mocked_collection.return_value.find_one.return_value = None
        mocked_getpass.side_effect = ["a-strong-local-password", "a-strong-local-password"]
        call_command(
            "create_dashboard_user",
            email="admin@example.com",
            name="Local Admin",
            stdout=StringIO(),
        )
        document = mocked_collection.return_value.insert_one.call_args.args[0]
        self.assertEqual(document["role"], "Administrator")
        self.assertNotEqual(document["passwordHash"], "a-strong-local-password")
        self.assertTrue(bcrypt.checkpw(b"a-strong-local-password", document["passwordHash"].encode()))