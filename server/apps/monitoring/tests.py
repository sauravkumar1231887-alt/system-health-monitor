from datetime import datetime, timedelta, timezone

from django.test import SimpleTestCase, override_settings

from common.fixtures import _DEMO, reset_demo_data
from apps.monitoring.management.commands.sync_offline_status import run_check


@override_settings(DEMO_MODE=True)
class OfflineMonitorTests(SimpleTestCase):
    def setUp(self):
        reset_demo_data()

    def test_offline_transition_emits_one_alert(self):
        system = _DEMO["systems"][0]
        system["status"] = "online"
        system["lastHeartbeat"] = datetime.now(timezone.utc) - timedelta(seconds=91)
        before = len(_DEMO["alerts"])
        run_check()
        self.assertEqual(system["status"], "offline")
        self.assertEqual(len(_DEMO["alerts"]), before + 1)
        run_check()
        self.assertEqual(len(_DEMO["alerts"]), before + 1)