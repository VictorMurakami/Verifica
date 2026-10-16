from __future__ import annotations

import logging
from typing import Mapping

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core import messages

logger = logging.getLogger(__name__)

MAX_BODY_BYTES = 32_768
MAX_PAGE_BYTES = 1_048_576


class BodySizeLimitMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        max_bytes: int = MAX_BODY_BYTES,
        path_limits: Mapping[str, int] | None = None,
    ) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.path_limits = path_limits or {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.path_limits.get(scope["path"], self.max_bytes)

        declared = _declared_length(scope)
        if declared is not None and declared > limit:
            logger.info("analyze outcome=too_large status=413")
            response = JSONResponse({"detail": messages.REQUEST_TOO_LARGE}, status_code=413)
            await response(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    logger.info("analyze outcome=too_large status=413")
                    # HTTPException atravessa o parser de body do FastAPI sem virar 400.
                    raise HTTPException(status_code=413, detail=messages.REQUEST_TOO_LARGE)
            return message

        await self.app(scope, limited_receive, send)


def _declared_length(scope: Scope) -> int | None:
    for name, value in scope["headers"]:
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None
