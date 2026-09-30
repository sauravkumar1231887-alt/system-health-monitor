import getpass
from datetime import datetime, timezone

import bcrypt
from django.core.management.base import BaseCommand, CommandError

from common.database import collection


class Command(BaseCommand):
    help = "Provision a Windows agent by storing only a bcrypt hash of its X-Agent-Key."

    def add_arguments(self, parser):
        parser.add_argument("--hostname", required=True)

    def handle(self, *args, **options):
        hostname = options["hostname"].strip()
        if not hostname:
            raise CommandError("Hostname cannot be empty")
        key = getpass.getpass("Agent API key (input hidden): ")
        if len(key) < 16:
            raise CommandError("Agent API key must contain at least 16 characters")
        systems = collection("systems")
        if systems.find_one({"hostname": hostname}):
            raise CommandError("A system with that hostname already exists")
        if systems.find_one({"agentTokenHash": {"$exists": True}}):
            for existing in systems.find({"agentTokenHash": {"$exists": True}}, {"agentTokenHash": 1}):
                try:
                    stored = existing["agentTokenHash"]
                    if bcrypt.checkpw(key.encode(), stored.encode() if isinstance(stored, str) else stored):
                        raise CommandError("That agent key is already provisioned")
                except (ValueError, TypeError):
                    continue
        now = datetime.now(timezone.utc)
        systems.insert_one({"hostname": hostname, "agentTokenHash": bcrypt.hashpw(key.encode(), bcrypt.gensalt()).decode(), "lastHeartbeat": None, "status": "offline", "createdAt": now, "updatedAt": now})
        self.stdout.write(self.style.SUCCESS(f"Provisioned agent system: {hostname}"))