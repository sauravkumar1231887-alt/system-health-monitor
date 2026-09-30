from functools import lru_cache
from urllib.parse import urlparse

from django.conf import settings
from pymongo import MongoClient


@lru_cache(maxsize=1)
def mongo_client():
    return MongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000)


def database():
    name = settings.MONGODB_DATABASE
    if not name:
        name = mongo_client().get_default_database().name if urlparse(settings.MONGODB_URI).path.strip("/") else "system-health-monitor"
    return mongo_client()[name]


def collection(name):
    return database()[name]


def close_mongo_client():
    mongo_client.cache_clear()