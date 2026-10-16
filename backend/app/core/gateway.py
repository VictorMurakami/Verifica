from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import Request

from app.core import messages
from app.core.config import Settings
from app.core.errors import GatewayAuthError

logger = logging.getLogger(__name__)

GATEWAY_HEADER = "X-Verifica-Gateway-Key"
CLIENT_IP_HEADER = "X-Verifica-Client-Ip"


def fingerprint_ip(ip: str, key: str) -> str:
    return hmac.new(key.encode("utf-8"), ip.encode("utf-8"), hashlib.sha256).hexdigest()


def client_ip(request: Request) -> str:
    settings: Settings = request.app.state.settings
    if not settings.gateway_key:
        return request.client.host if request.client else "unknown"
    provided = request.headers.get(GATEWAY_HEADER, "")
    if not hmac.compare_digest(provided.encode("utf-8"), settings.gateway_key.encode("utf-8")):
        logger.warning("gateway rejected reason=key")
        raise GatewayAuthError(messages.UNAUTHORIZED)
    ip = request.headers.get(CLIENT_IP_HEADER, "").strip()
    if not ip:
        logger.warning("gateway rejected reason=client-ip")
        raise GatewayAuthError(messages.UNAUTHORIZED)
    return ip
