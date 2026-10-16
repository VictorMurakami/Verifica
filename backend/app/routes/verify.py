from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import AppError
from app.core.gateway import client_ip, fingerprint_ip

logger = logging.getLogger(__name__)
router = APIRouter()


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    content: str
    id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9-]+$")


@router.post("/api/analyze")
def analyze(body: AnalyzeRequest, request: Request, ip: str = Depends(client_ip)) -> dict:
    fingerprint = fingerprint_ip(ip, request.app.state.settings.ip_hash_key)
    started = time.monotonic()
    try:
        outcome = request.app.state.verifier.analyze(body.content, body.id, fingerprint)
    except AppError as exc:
        _log(body.id, fingerprint, "erro", exc.status_code, started)
        raise
    except Exception:
        _log(body.id, fingerprint, "erro", 500, started)
        raise
    _log(body.id, fingerprint, "cache" if outcome.from_cache else "ok", 200, started)
    return outcome.payload


def _log(request_id: str | None, fingerprint: str, outcome: str, status: int, started: float) -> None:
    elapsed_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        "analyze id=%s ip=%s outcome=%s status=%d ms=%d",
        request_id or "-", fingerprint[:8], outcome, status, elapsed_ms,
    )
