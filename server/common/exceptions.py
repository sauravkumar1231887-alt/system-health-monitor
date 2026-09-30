import logging

from rest_framework.response import Response
from rest_framework.exceptions import NotAuthenticated
from rest_framework.views import exception_handler

from common.logging_utils import log_failure

logger = logging.getLogger("api.errors")


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        log_failure(logger, "Unhandled API exception", exc)
        return Response({"message": "Internal server error"}, status=500)
    if isinstance(exc, NotAuthenticated):
        response.data = {"message": "Authentication required"}
    elif isinstance(response.data, dict) and response.data.get("detail"):
        response.data = {"message": str(response.data["detail"])}
    return response