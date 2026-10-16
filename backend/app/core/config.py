from __future__ import annotations

import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from dotenv import load_dotenv

DEFAULT_MODEL = "google/gemma-4-26b-a4b-it"
ALLOWED_MODELS = frozenset({"google/gemma-4-26b-a4b-it", "google/gemma-4-26b-a4b-it:free"})
MIN_SECRET_LENGTH = 32
PLACEHOLDER_PREFIX = "troque-"
DEV_IP_HASH_KEY = "development-only-ip-hash-key"
ENVIRONMENTS = ("development", "production")
MIN_PRICE_PER_MILLION = 0.01
MAX_PRICE_PER_MILLION = 1.0
DEFAULT_MAX_PROMPT_PRICE = 0.15
DEFAULT_MAX_COMPLETION_PRICE = 0.60


class ConfigError(RuntimeError):
    """Configuração inválida: o processo não deve subir."""


@dataclass(frozen=True)
class Settings:
    env: str
    openrouter_api_key: str
    model_name: str
    gateway_key: str
    ip_hash_key: str
    quota_global_daily: int
    quota_per_ip_daily: int
    llm_per_minute: int
    llm_max_concurrency: int
    llm_max_prompt_price: float
    llm_max_completion_price: float
    cache_ttl_hours: int
    data_dir: Path

    @property
    def is_production(self) -> bool:
        return self.env == "production"


def _reject_placeholder(name: str, value: str) -> str:
    if value.startswith(PLACEHOLDER_PREFIX):
        raise ConfigError(f"{name} ainda está com o valor de exemplo")
    return value


def _secret(environ: Mapping[str, str], name: str, required: bool) -> str:
    value = _reject_placeholder(name, environ.get(name, "").strip())
    if required and len(value) < MIN_SECRET_LENGTH:
        raise ConfigError(f"{name} é obrigatória em produção (mínimo {MIN_SECRET_LENGTH} caracteres)")
    return value


def _positive_int(environ: Mapping[str, str], name: str, default: int) -> int:
    raw = environ.get(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} precisa ser um inteiro, recebido {raw!r}") from exc
    if value <= 0:
        raise ConfigError(f"{name} precisa ser maior que zero, recebido {value}")
    return value


def _price(environ: Mapping[str, str], name: str, default: float) -> float:
    raw = environ.get(name, str(default)).strip()
    try:
        value = float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} precisa ser um número, recebido {raw!r}") from exc
    if not math.isfinite(value):
        raise ConfigError(f"{name} precisa ser um número finito, recebido {raw!r}")
    if value < MIN_PRICE_PER_MILLION:
        raise ConfigError(
            f"{name} precisa ser pelo menos {MIN_PRICE_PER_MILLION} USD por milhão de tokens, recebido {value}"
        )
    if value > MAX_PRICE_PER_MILLION:
        raise ConfigError(f"{name} não pode passar de {MAX_PRICE_PER_MILLION} USD/milhão de tokens, recebido {value}")
    return value


def load_settings(environ: Mapping[str, str] | None = None) -> Settings:
    if environ is None:
        load_dotenv()
        environ = os.environ

    env = environ.get("ENV", "production").strip()
    if env not in ENVIRONMENTS:
        raise ConfigError(f"ENV precisa ser um de {ENVIRONMENTS}, recebido {env!r}")
    production = env == "production"

    api_key = _reject_placeholder("OPENROUTER_API_KEY", environ.get("OPENROUTER_API_KEY", "").strip())
    if not api_key:
        raise ConfigError("OPENROUTER_API_KEY ausente")

    model_name = environ.get("MODEL_NAME", DEFAULT_MODEL).strip()
    if model_name not in ALLOWED_MODELS:
        raise ConfigError(f"MODEL_NAME precisa ser um de {sorted(ALLOWED_MODELS)!r}, recebido {model_name!r}")

    return Settings(
        env=env,
        openrouter_api_key=api_key,
        model_name=model_name,
        gateway_key=_secret(environ, "GATEWAY_KEY", required=production),
        ip_hash_key=_secret(environ, "IP_HASH_KEY", required=production) or DEV_IP_HASH_KEY,
        quota_global_daily=_positive_int(environ, "QUOTA_GLOBAL_DAILY", 200),
        quota_per_ip_daily=_positive_int(environ, "QUOTA_PER_IP_DAILY", 10),
        llm_per_minute=_positive_int(environ, "LLM_PER_MINUTE", 15),
        llm_max_concurrency=_positive_int(environ, "LLM_MAX_CONCURRENCY", 2),
        llm_max_prompt_price=_price(environ, "LLM_MAX_PROMPT_PRICE", DEFAULT_MAX_PROMPT_PRICE),
        llm_max_completion_price=_price(environ, "LLM_MAX_COMPLETION_PRICE", DEFAULT_MAX_COMPLETION_PRICE),
        cache_ttl_hours=_positive_int(environ, "CACHE_TTL_HOURS", 24),
        data_dir=Path(environ.get("DATA_DIR", "data")),
    )
