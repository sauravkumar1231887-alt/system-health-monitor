from datetime import date, datetime, timezone

from bson import ObjectId


def json_value(value):
    if isinstance(value, (datetime, date)):
        if isinstance(value, datetime) and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, list):
        return [json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items() if key not in {"agentToken", "agentTokenHash", "passwordHash"}}
    return value


def mongo_document(document):
    if document is None:
        return None
    result = json_value(document)
    result["_id"] = str(document["_id"])
    return result