import logging
from datetime import datetime, timedelta, timezone

import bcrypt
from bson import ObjectId
from django.conf import settings
from pymongo import ReturnDocument

from common.database import collection
from common.fixtures import demo_collection
from common.serialization import json_value, mongo_document
from common.status import DEFAULT_SETTINGS, system_status


logger = logging.getLogger("monitoring.systems")


def _id_query(value):
    candidates = [{"_id": value}]
    if ObjectId.is_valid(value):
        candidates.insert(0, {"_id": ObjectId(value)})
    return {"$or": candidates}


def get_settings():
    if settings.DEMO_MODE:
        return demo_collection("settings")
    document = collection("settings").find_one_and_update({}, {"$setOnInsert": DEFAULT_SETTINGS}, upsert=True, return_document=ReturnDocument.AFTER)
    return {key: document.get(key, value) for key, value in DEFAULT_SETTINGS.items()}


def list_systems():
    systems = demo_collection("systems") if settings.DEMO_MODE else [mongo_document(item) for item in collection("systems").find({})]
    current_settings = get_settings()
    for system in systems:
        system["status"] = system_status(system, current_settings)
    return systems


def get_system(system_id):
    if settings.DEMO_MODE:
        system = next((item for item in demo_collection("systems") if item["_id"] == system_id), None)
    else:
        document = collection("systems").find_one(_id_query(system_id))
        system = mongo_document(document)
    if system:
        system["status"] = system_status(system, get_settings())
    return system


def find_agent_system(agent_key):
    if not agent_key:
        return None
    if settings.DEMO_MODE:
        return next((item for item in demo_collection("systems") if item.get("agentToken") == agent_key), None)
    for system in collection("systems").find({"agentTokenHash": {"$exists": True}}, {"agentTokenHash": 1}):
        token_hash = system.get("agentTokenHash")
        if token_hash:
            try:
                if bcrypt.checkpw(agent_key.encode(), token_hash.encode() if isinstance(token_hash, str) else token_hash):
                    return mongo_document(collection("systems").find_one({"_id": system["_id"]}))
            except (ValueError, TypeError):
                logger.warning("Stored agent credential hash is invalid")
    return None


def update_heartbeat(system, payload):
    now = datetime.now(timezone.utc)
    updated = {**payload, "lastHeartbeat": now, "liveMonitoringAt": now, "updatedAt": now}
    system.update(updated)
    current_settings = get_settings()
    system["status"] = system_status(system, current_settings, now)
    updated["status"] = system["status"]
    if settings.DEMO_MODE:
        for item in _demo_systems():
            if item["_id"] == system["_id"]:
                item.update(updated)
                item["status"] = system["status"]
                break
        _append_demo_metric(system, payload, now)
        return system
    collection("systems").update_one({"_id": _mongo_id(system["_id"])}, {"$set": updated})
    metric = _metric_document(system, payload, now)
    metric["systemId"] = _mongo_id(system["_id"])
    metric["expiresAt"] = now + timedelta(days=30)
    collection("systemmetrics").insert_one(metric)
    return system


def _mongo_id(value):
    return ObjectId(value) if ObjectId.is_valid(value) else value


def _demo_systems():
    from common.fixtures import _DEMO
    return _DEMO["systems"]


def _metric_document(system, payload, timestamp):
    network = payload.get("network") or {}
    traffic = network.get("traffic") or {}
    ups = payload.get("ups") or {}
    battery = ups.get("chargePercent")
    return {
        "cpuPercent": system.get("cpuPercent"),
        "memoryPercent": system.get("memoryPercent"),
        "diskPercent": system.get("diskPercent"),
        "uploadBytesPerSecond": traffic.get("uploadBytesPerSecond"),
        "downloadBytesPerSecond": traffic.get("downloadBytesPerSecond"),
        "upsBatteryPercent": battery if isinstance(battery, (int, float)) else None,
        "systemHealth": payload.get("systemHealth"),
        "network": payload.get("network"),
        "ups": payload.get("ups"),
        "timestamp": timestamp,
    }


def _append_demo_metric(system, payload, timestamp):
    from common.fixtures import _DEMO
    _DEMO["systemmetrics"].insert(0, {"systemId": system["_id"], **_metric_document(system, payload, timestamp)})


def get_metrics(system_id, limit=200, start=None, end=None):
    if settings.DEMO_MODE:
        metrics = demo_collection("systemmetrics")
    else:
        query = {"systemId": _mongo_id(system_id)}
        if start or end:
            query["timestamp"] = {}
            if start:
                query["timestamp"]["$gte"] = start
            if end:
                query["timestamp"]["$lte"] = end
        metrics = [mongo_document(item) for item in collection("systemmetrics").find(query).sort("timestamp", -1).limit(limit)]
    filtered = [item for item in metrics if str(item.get("systemId")) == str(system_id)]
    if start:
        filtered = [item for item in filtered if _as_datetime(item.get("timestamp")) >= start]
    if end:
        filtered = [item for item in filtered if _as_datetime(item.get("timestamp")) <= end]
    return filtered[:limit]


def get_history(system_id, start, end, bucket_seconds):
    if settings.DEMO_MODE:
        metrics = get_metrics(system_id, limit=100000, start=start, end=end)
        buckets = {}
        for metric in metrics:
            timestamp = _as_datetime(metric.get("timestamp"))
            bucket = int(timestamp.timestamp()) // bucket_seconds * bucket_seconds
            buckets.setdefault(bucket, []).append(metric)
        return [_average_metrics(bucket, items) for bucket, items in sorted(buckets.items())]

    bucket_milliseconds = bucket_seconds * 1000
    pipeline = [
        {"$match": {"systemId": _mongo_id(system_id), "timestamp": {"$gte": start, "$lte": end}}},
        {"$group": {
            "_id": {"$floor": {"$divide": [{"$toLong": "$timestamp"}, bucket_milliseconds]}},
            "cpuPercent": {"$avg": "$cpuPercent"},
            "memoryPercent": {"$avg": "$memoryPercent"},
            "diskPercent": {"$avg": "$diskPercent"},
            "uploadBytesPerSecond": {"$avg": "$uploadBytesPerSecond"},
            "downloadBytesPerSecond": {"$avg": "$downloadBytesPerSecond"},
            "upsBatteryPercent": {"$avg": "$upsBatteryPercent"},
        }},
        {"$project": {"timestamp": {"$toDate": {"$multiply": ["$_id", bucket_milliseconds]}},
            "cpuPercent": 1, "memoryPercent": 1, "diskPercent": 1,
            "uploadBytesPerSecond": 1, "downloadBytesPerSecond": 1, "upsBatteryPercent": 1}},
        {"$sort": {"timestamp": 1}},
    ]
    return [json_value(item) for item in collection("systemmetrics").aggregate(pipeline)]


def _average_metrics(bucket, items):
    result = {"timestamp": datetime.fromtimestamp(bucket, timezone.utc)}
    for key in ("cpuPercent", "memoryPercent", "diskPercent", "uploadBytesPerSecond", "downloadBytesPerSecond", "upsBatteryPercent"):
        values = [item[key] for item in items if isinstance(item.get(key), (int, float))]
        result[key] = sum(values) / len(values) if values else None
    return result


def _as_datetime(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return datetime.min.replace(tzinfo=timezone.utc)
    if not isinstance(value, datetime):
        return datetime.min.replace(tzinfo=timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def list_named(name):
    if settings.DEMO_MODE:
        return demo_collection(name)
    return [mongo_document(item) for item in collection(name).find({}).sort("timestamp" if name == "auditlogs" else "createdAt", -1)]


def get_alert(alert_id):
    if settings.DEMO_MODE:
        return next((item for item in demo_collection("alerts") if item["_id"] == alert_id), None)
    return mongo_document(collection("alerts").find_one(_id_query(alert_id)))


def save_alert(alert):
    if settings.DEMO_MODE:
        from common.fixtures import _DEMO
        for item in _DEMO["alerts"]:
            if item["_id"] == alert["_id"]:
                item.update(alert)
                break
        return alert
    collection("alerts").update_one({"_id": _mongo_id(alert["_id"])}, {"$set": {"status": alert["status"]}})
    return alert


def insert_document(name, document):
    if settings.DEMO_MODE:
        from common.fixtures import _DEMO
        _DEMO[name].insert(0, document)
        return document
    result = collection(name).insert_one(document)
    return mongo_document({**document, "_id": result.inserted_id})