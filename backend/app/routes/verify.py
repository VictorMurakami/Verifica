from __future__ import annotations

import ipaddress
import logging
import re
import time
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.requests import ClientDisconnect

from app.core import messages
from app.core.errors import AppError, InputError
from app.core.gateway import client_ip, fingerprint_ip
from app.services.safe_fetch import FetchedPage
from app.services.verifier import is_url

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_URL_HEADER_LENGTH = 2048
_CHARSET_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,40}$")
_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,64}$")
_CONTROL_OR_SPACE = re.compile(r"[\x00-\x20\x7f]")


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


@router.post("/api/analyze-page")
async def analyze_page(request: Request, ip: str = Depends(client_ip)) -> dict:
    fingerprint = fingerprint_ip(ip, request.app.state.settings.ip_hash_key)
    started = time.monotonic()
    request_id = None
    try:
        request_id = _optional_matching_header(request, "X-Verifica-Request-Id", _REQUEST_ID_PATTERN)
        source_url = _require_url_header(request, "X-Verifica-Source-Url")
        page_url = _require_url_header(request, "X-Verifica-Page-Url")
        charset = _optional_matching_header(request, "X-Verifica-Page-Charset", _CHARSET_PATTERN)
        body = await request.body()
        page = FetchedPage(url=page_url, content=body, charset=charset)
        outcome = await run_in_threadpool(
            request.app.state.verifier.analyze, source_url, request_id, fingerprint, page
        )
    except ClientDisconnect:
        _log(request_id, fingerprint, "disconnect", 400, started)
        raise InputError(messages.INVALID_REQUEST)
    except HTTPException:
        raise
    except AppError as exc:
        _log(request_id, fingerprint, "erro", exc.status_code, started)
        raise
    except Exception:
        _log(request_id, fingerprint, "erro", 500, started)
        raise
    _log(request_id, fingerprint, "cache" if outcome.from_cache else "ok", 200, started)
    return outcome.payload


def _require_url_header(request: Request, header: str) -> str:
    value = request.headers.get(header, "").strip()
    if not value or len(value) > MAX_URL_HEADER_LENGTH or not is_url(value):
        raise InputError(messages.INVALID_REQUEST)
    if _CONTROL_OR_SPACE.search(value):
        raise InputError(messages.INVALID_REQUEST)
    parsed = urlparse(value)
    if parsed.username is not None or parsed.password is not None or "@" in parsed.netloc or "\\" in parsed.netloc:
        raise InputError(messages.INVALID_REQUEST)
    if not _is_valid_host(parsed.hostname or ""):
        raise InputError(messages.INVALID_REQUEST)
    return value


def _is_valid_host(hostname: str) -> bool:
    hostname = hostname.rstrip(".")
    if not hostname or "." not in hostname:
        return False
    try:
        ipaddress.ip_address(hostname)
        return False
    except ValueError:
        pass
    last_label = hostname.rsplit(".", 1)[-1]
    if last_label.isdigit() or last_label.lower().startswith("0x"):
        return False
    return True


def _optional_matching_header(request: Request, header: str, pattern: re.Pattern[str]) -> str | None:
    value = request.headers.get(header, "").strip()
    if not value or not pattern.match(value):
        return None
    return value


def _log(request_id: str | None, fingerprint: str, outcome: str, status: int, started: float) -> None:
    elapsed_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        "analyze id=%s ip=%s outcome=%s status=%d ms=%d",
        request_id or "-", fingerprint[:8], outcome, status, elapsed_ms,
    )
