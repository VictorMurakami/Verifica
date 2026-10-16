from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core import messages

logger = logging.getLogger(__name__)


class AppError(Exception):
    status_code = 500

    def __init__(self, message: str, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after = retry_after


class InputError(AppError):
    status_code = 400


class GatewayAuthError(AppError):
    status_code = 401


class QuotaExceeded(AppError):
    status_code = 429


class UpstreamError(AppError):
    status_code = 502


class BusyError(AppError):
    status_code = 503


class UpstreamTimeout(AppError):
    status_code = 504


def _json_error(status_code: int, message: str, retry_after: int | None = None) -> JSONResponse:
    headers = {"Retry-After": str(retry_after)} if retry_after is not None else None
    return JSONResponse({"detail": message}, status_code=status_code, headers=headers)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return _json_error(exc.status_code, exc.message, exc.retry_after)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        logger.info("analyze outcome=invalid status=400")
        return _json_error(400, messages.INVALID_REQUEST)

    @app.exception_handler(Exception)
    async def handle_unexpected(_request: Request, exc: Exception) -> JSONResponse:
        logger.error("erro inesperado: %s", type(exc).__name__, exc_info=exc)
        return _json_error(500, messages.UNEXPECTED)
