import logging
import time
from datetime import datetime, timezone

from django.conf import settings
from django.core.management.base import BaseCommand

from common.database import collection
from common.fixtures import _DEMO
from common.status import system_status
from common.logging_utils import log_failure
from apps.systems.repository import get_settings


logger = logging.getLogger("monitoring.offline")


def run_check():
    current_settings = get_settings()
    if settings.DEMO_MODE:
        systems = _DEMO["systems"]
    else:
        systems = list(collection("systems").find({}))
    for system in systems:
        old_status = system.get("status")
        updated_status = system_status(system, current_settings)
        if settings.DEMO_MODE:
            system["status"] = updated_status
            if updated_status == "offline" and old_status != "offline":
                _DEMO["alerts"].insert(0, {"_id": __import__("uuid").uuid4().hex, "system": system.get("hostname"), "type": "System offline", "severity": "critical", "message": f"{system.get('hostname')} has stopped communicating with the monitoring server.", "status": "open", "createdAt": datetime.now(timezone.utc)})
        else:
            collection("systems").update_one({"_id": system["_id"]}, {"$set": {"status": updated_status}})
            if updated_status == "offline" and old_status != "offline":
                collection("alerts").insert_one({"system": system.get("hostname"), "type": "System offline", "severity": "critical", "message": f"{system.get('hostname')} has stopped communicating with the monitoring server.", "status": "open", "createdAt": datetime.now(timezone.utc)})


class Command(BaseCommand):
    help = "Recalculate endpoint online/offline status every 30 seconds. Run as a separate process."

    def handle(self, *args, **options):
        self.stdout.write("Offline status monitor started; interval=30s")
        while True:
            try:
                run_check()
            except Exception as error:
                log_failure(logger, "Offline status update failed", error)
            time.sleep(30)