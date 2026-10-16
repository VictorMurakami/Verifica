from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from typing import Callable, Protocol
from urllib.parse import urlparse

from app.core import messages
from app.core.config import Settings
from app.core.errors import BusyError, InputError
from app.services.cache import ResultCache, cache_key, canonical_url
from app.services.db import Database
from app.services.llm import CATEGORIAS, LlmClient, detect_injection
from app.services.quota import QuotaStore
from app.services.safe_fetch import FetchedPage
from app.services.scraper import extract_text, extract_text_from_url
from app.services.throttle import Throttle

logger = logging.getLogger(__name__)

MAX_CONTENT_CHARS = 12_000
MAX_EXCERPTS = 5
MAX_EXCERPT_CHARS = 240
MAX_VERDICT_CHARS = 600
MAX_REASON_CHARS = 300
MAX_SUGGESTION_CHARS = 300
DEFAULT_SCORE = 5


class Analyzer(Protocol):
    def analyze(self, *, texto: str, contexto: str) -> dict: ...


@dataclass(frozen=True)
class AnalysisOutcome:
    payload: dict
    from_cache: bool


def is_url(value: str) -> bool:
    try:
        parsed = urlparse(value.strip())
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _page_cache_key(source_url: str, texto: str) -> str:
    # Liga o cache ao conteúdo extraído, não só à URL: conteúdo diferente não reaproveita resultado.
    content_hash = hashlib.sha256(texto.encode("utf-8")).hexdigest()
    material = f"u:{canonical_url(source_url)}|{content_hash}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def clamp_score(value) -> int:
    try:
        if isinstance(value, str):
            value = value.replace("%", "").strip()
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return DEFAULT_SCORE
    return max(0, min(100, number))


def normalize_excerpts(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:MAX_EXCERPTS]:
        if not isinstance(item, dict) or item.get("category") not in CATEGORIAS:
            continue
        excerpt = str(item.get("excerpt", "")).strip()[:MAX_EXCERPT_CHARS]
        if not excerpt:
            continue
        out.append(
            {
                "excerpt": excerpt,
                "reason": str(item.get("reason", "")).strip()[:MAX_REASON_CHARS],
                "category": item["category"],
                "suggestion": str(item.get("suggestion", "")).strip()[:MAX_SUGGESTION_CHARS],
            }
        )
    return out


@dataclass
class Verifier:
    cache: ResultCache
    quota: QuotaStore
    throttle: Throttle
    llm: Analyzer
    fetch_page: Callable[[str], str]
    extract_page: Callable[[FetchedPage], str]

    def analyze(
        self, content: str, request_id: str | None, fingerprint: str, page: FetchedPage | None = None
    ) -> AnalysisOutcome:
        text = (content or "").strip()
        if not text:
            raise InputError(messages.EMPTY_INPUT)
        if len(text) > MAX_CONTENT_CHARS:
            raise InputError(messages.INPUT_TOO_LONG)

        url = text if is_url(text) else None
        if page is not None and url is None:
            raise InputError(messages.INVALID_REQUEST)

        if page is not None:
            with self.throttle.fetch_slot():
                texto, contexto = "", self.extract_page(page)
            key = _page_cache_key(url, contexto)
            cached = self.cache.get(key)
            if cached is not None:
                return AnalysisOutcome(payload={**cached, "requestId": request_id or ""}, from_cache=True)
            self.quota.ensure_available(fingerprint)
        else:
            key = cache_key(text, is_url=url is not None)
            cached = self.cache.get(key)
            if cached is not None:
                return AnalysisOutcome(payload={**cached, "requestId": request_id or ""}, from_cache=True)
            if url:
                self.quota.ensure_available(fingerprint)
                with self.throttle.fetch_slot():
                    texto, contexto = "", self.fetch_page(canonical_url(url))
            else:
                texto, contexto = text, ""
        if detect_injection(texto) or detect_injection(contexto):
            raise InputError(messages.INJECTION)

        with self.throttle.concurrency_slot():
            self.quota.reserve(fingerprint)
            try:
                self.throttle.take_minute_token()
            except BusyError:
                self.quota.release(fingerprint)
                raise
            raw = self.llm.analyze(texto=texto, contexto=contexto)

        payload = {
            "reliabilityScore": clamp_score(raw.get("score")),
            "overallVerdict": str(raw.get("verdict", "")).strip()[:MAX_VERDICT_CHARS],
            "flaggedExcerpts": normalize_excerpts(raw.get("excerpts")),
            "analyzedText": texto or contexto,
        }
        self.cache.put(key, payload)
        return AnalysisOutcome(payload={**payload, "requestId": request_id or ""}, from_cache=False)


def _fetch_page_disabled_in_production(url: str) -> str:
    logger.warning("download no servidor desativado em produção")
    raise InputError(messages.URL_BLOCKED)


def build_verifier(settings: Settings) -> Verifier:
    db = Database(settings.data_dir / "verifica.db")
    return Verifier(
        cache=ResultCache(db, ttl_seconds=settings.cache_ttl_hours * 3600),
        quota=QuotaStore(db, per_ip_daily=settings.quota_per_ip_daily, global_daily=settings.quota_global_daily),
        throttle=Throttle(max_concurrency=settings.llm_max_concurrency, per_minute=settings.llm_per_minute),
        llm=LlmClient(api_key=settings.openrouter_api_key, model=settings.model_name),
        fetch_page=_fetch_page_disabled_in_production if settings.is_production else extract_text_from_url,
        extract_page=extract_text,
    )
