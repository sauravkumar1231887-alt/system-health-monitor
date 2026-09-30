import getpass
import re
from datetime import datetime, timezone

import bcrypt
from django.core.management.base import BaseCommand, CommandError

from common.database import collection


class Command(BaseCommand):
    help = "Create an Administrator dashboard user in MongoDB."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--name", required=True)

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        name = options["name"].strip()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise CommandError("Enter a valid email address")
        if not name:
            raise CommandError("Name cannot be empty")

        password = getpass.getpass("Dashboard password (input hidden): ")
        confirmation = getpass.getpass("Confirm password: ")
        if len(password) < 12:
            raise CommandError("Password must contain at least 12 characters")
        if password != confirmation:
            raise CommandError("Passwords do not match")

        users = collection("users")
        if users.find_one({"email": email}):
            raise CommandError("A dashboard user with that email already exists")

        users.insert_one({
            "email": email,
            "name": name,
            "role": "Administrator",
            "passwordHash": bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode(),
            "createdAt": datetime.now(timezone.utc),
        })
        self.stdout.write(self.style.SUCCESS(f"Created dashboard Administrator: {email}"))