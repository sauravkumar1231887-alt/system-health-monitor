import logging

from django.core.management.base import BaseCommand
from pymongo.errors import PyMongoError

from common.database import collection
from common.logging_utils import log_failure


logger = logging.getLogger("monitoring.indexes")


class Command(BaseCommand):
    help = "Create compatible non-destructive MongoDB indexes used by the monitoring API."

    def handle(self, *args, **options):
        indexes = {
            "systems": [("hostname", 1)],
            "systemmetrics": [("systemId", 1), ("timestamp", -1)],
            "commands": [("systemId", 1), ("status", 1), ("createdAt", -1)],
            "alerts": [("systemId", 1), ("createdAt", -1)],
            "auditlogs": [("timestamp", -1)],
            "users": [("email", 1)],
        }
        for name, keys in indexes.items():
            try:
                options = {"background": True}
                if name in {"systems", "users"} and keys[0][0] in {"hostname", "email"}:
                    options["unique"] = True
                collection(name).create_index(keys, **options)
                self.stdout.write(self.style.SUCCESS(f"Ensured indexes for {name}"))
            except PyMongoError as error:
                log_failure(logger, f"Index creation failed for collection {name}", error)
                self.stderr.write(self.style.ERROR(f"Could not ensure indexes for {name}; existing data was not modified"))
        try:
            collection("systemmetrics").create_index("expiresAt", expireAfterSeconds=0, name="live_metric_expiry")
            self.stdout.write(self.style.SUCCESS("Ensured 30-day monitoring history retention"))
        except PyMongoError as error:
            log_failure(logger, "Monitoring history retention index failed", error)
            self.stderr.write(self.style.ERROR("Could not ensure monitoring history retention index"))