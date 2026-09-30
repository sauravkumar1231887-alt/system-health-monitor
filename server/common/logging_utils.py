import logging


def log_failure(logger: logging.Logger, message: str, error: Exception):
    logger.error("%s (error_type=%s)", message, type(error).__name__)