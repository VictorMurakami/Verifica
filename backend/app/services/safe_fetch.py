from __future__ import annotations

import contextvars
import ipaddress
import logging
import re
import socket
import threading
import time
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urljoin, urlsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool

from app.core import messages
from app.core.errors import InputError, UpstreamError, UpstreamTimeout

logger = logging.getLogger(__name__)

ALLOWED_SCHEMES = frozenset({"http", "https"})
ALLOWED_PORTS = frozenset({80, 443})
HTML_CONTENT_TYPES = frozenset({"text/html", "application/xhtml+xml"})
MAX_REDIRECTS = 3
MAX_BYTES = 2 * 1024 * 1024
CONNECT_TIMEOUT_SECONDS = 5.0
TOTAL_DEADLINE_SECONDS = 10.0
CHUNK_SIZE = 64 * 1024

NAT64_NETWORKS = (
    ipaddress.ip_network("64:ff9b::/96"),
    ipaddress.ip_network("64:ff9b:1::/48"),
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}

_CHARSET_RE = re.compile(r"charset\s*=\s*[\"']?([\w.:-]+)", re.IGNORECASE)

Resolver = Callable[[str, int], list[str]]
Clock = Callable[[], float]

_current_watchdog: contextvars.ContextVar["_Watchdog | None"] = contextvars.ContextVar(
    "verifica_fetch_watchdog", default=None
)


@dataclass(frozen=True)
class FetchedPage:
    url: str
    content: bytes
    charset: str | None


def system_resolver(host: str, port: int) -> list[str]:
    return [info[4][0] for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)]


def is_public_ip(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        if any(ip in network for network in NAT64_NETWORKS):
            return False
        if ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _blocked(host: str | None) -> InputError:
    logger.warning("blocked host=%r", host or "-")
    return InputError(messages.URL_BLOCKED)


def validate_url(url: str, resolver: Resolver = system_resolver) -> str:
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    host = parts.hostname
    if scheme not in ALLOWED_SCHEMES or not host:
        raise _blocked(host)
    if parts.username is not None or parts.password is not None:
        raise _blocked(host)
    try:
        port = parts.port or (443 if scheme == "https" else 80)
    except ValueError:
        raise _blocked(host) from None
    if port not in ALLOWED_PORTS:
        raise _blocked(host)
    if _is_ip_literal(host):
        addresses = [host]
    else:
        try:
            addresses = resolver(host, port)
        except (OSError, UnicodeError):
            raise InputError(messages.URL_UNREACHABLE) from None
    if not addresses or not all(is_public_ip(address) for address in addresses):
        raise _blocked(host)
    return host


class _BlockedPeer(Exception):
    """O socket conectou num IP não público (DNS rebinding)."""


class _PeerCheckMixin:
    def _new_conn(self):
        sock = super()._new_conn()
        peer = sock.getpeername()[0]
        if not is_public_ip(peer):
            sock.close()
            raise _BlockedPeer(peer)
        watchdog = _current_watchdog.get()
        if watchdog is not None:
            # O TLS faz detach() do socket original; o dup() mantém o watchdog na conexão real.
            watchdog.register(sock.dup())
        return sock


class _SafeHTTPConnection(_PeerCheckMixin, HTTPConnection):
    pass


class _SafeHTTPSConnection(_PeerCheckMixin, HTTPSConnection):
    pass


class _SafeHTTPPool(HTTPConnectionPool):
    ConnectionCls = _SafeHTTPConnection


class _SafeHTTPSPool(HTTPSConnectionPool):
    ConnectionCls = _SafeHTTPSConnection


class _SafeAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        super().init_poolmanager(*args, **kwargs)
        self.poolmanager.pool_classes_by_scheme = {"http": _SafeHTTPPool, "https": _SafeHTTPSPool}


def new_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False
    adapter = _SafeAdapter(max_retries=0)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


class _Watchdog:
    """Corta todos os sockets registrados no fim do prazo: read() bloqueante não volta a checar o relógio."""

    def __init__(self, seconds: float) -> None:
        self.fired = False
        self._sockets: list[socket.socket] = []
        self._lock = threading.Lock()
        self._timer = threading.Timer(max(seconds, 0.0), self._cut)
        self._timer.daemon = True
        self._timer.start()

    def register(self, sock: socket.socket) -> None:
        with self._lock:
            self._sockets.append(sock)
            fired = self.fired
        if fired:
            self._shutdown(sock)

    def _cut(self) -> None:
        self.fired = True
        with self._lock:
            sockets = list(self._sockets)
        if not sockets:
            logger.warning("watchdog sem socket registrado")
            return
        for sock in sockets:
            self._shutdown(sock)

    @staticmethod
    def _shutdown(sock: socket.socket) -> None:
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def cancel(self) -> None:
        self._timer.cancel()
        with self._lock:
            sockets = list(self._sockets)
        for sock in sockets:
            try:
                sock.close()
            except OSError:
                pass


def fetch_html(
    url: str,
    *,
    session: requests.Session | None = None,
    resolver: Resolver = system_resolver,
    clock: Clock = time.monotonic,
) -> FetchedPage:
    owns_session = session is None
    http = session or new_session()
    watchdog = _Watchdog(TOTAL_DEADLINE_SECONDS)
    token = _current_watchdog.set(watchdog)
    try:
        deadline = clock() + TOTAL_DEADLINE_SECONDS
        current = url
        for _ in range(MAX_REDIRECTS + 1):
            host = validate_url(current, resolver)
            remaining = deadline - clock()
            if remaining <= 0:
                raise UpstreamTimeout(messages.PAGE_TIMEOUT)
            response = _get(http, current, host, remaining, watchdog)
            with response:
                if response.is_redirect:
                    current = urljoin(current, response.headers.get("Location", ""))
                    continue
                _raise_for_status(response.status_code)
                content_type = response.headers.get("Content-Type", "")
                if content_type.split(";", 1)[0].strip().lower() not in HTML_CONTENT_TYPES:
                    raise InputError(messages.PAGE_NOT_HTML)
                body = _read_limited(response, deadline, clock, watchdog)
                return FetchedPage(url=current, content=body, charset=_charset(content_type))
        raise InputError(messages.PAGE_TOO_MANY_REDIRECTS)
    finally:
        watchdog.cancel()
        _current_watchdog.reset(token)
        if owns_session:
            http.close()


def _get(
    http: requests.Session,
    url: str,
    host: str,
    remaining: float,
    watchdog: _Watchdog,
) -> requests.Response:
    try:
        response = http.get(
            url,
            headers=HEADERS,
            timeout=(CONNECT_TIMEOUT_SECONDS, remaining),
            allow_redirects=False,
            stream=True,
        )
    except _BlockedPeer:
        logger.warning("blocked host=%r peer", host)
        raise InputError(messages.URL_BLOCKED) from None
    except requests.exceptions.RequestException as exc:
        # Prazo antes de SSLError/ConnectionError: o corte do watchdog parece erro de TLS.
        if watchdog.fired:
            raise UpstreamTimeout(messages.PAGE_TIMEOUT) from None
        if isinstance(exc, requests.exceptions.SSLError):
            raise InputError(messages.PAGE_SSL) from None
        if isinstance(exc, requests.exceptions.Timeout):
            raise UpstreamTimeout(messages.PAGE_TIMEOUT) from None
        if isinstance(exc, requests.exceptions.ConnectionError):
            raise UpstreamError(messages.PAGE_CONNECTION) from None
        raise UpstreamError(messages.PAGE_NETWORK) from None
    if watchdog.fired:
        response.close()
        raise UpstreamTimeout(messages.PAGE_TIMEOUT)
    return response


def _raise_for_status(status: int) -> None:
    if status < 400:
        return
    if status in (401, 403):
        raise InputError(messages.PAGE_FORBIDDEN)
    if status == 404:
        raise InputError(messages.PAGE_NOT_FOUND)
    if status == 429:
        raise UpstreamError(messages.PAGE_RATE_LIMITED)
    if status >= 500:
        raise UpstreamError(messages.PAGE_SERVER_ERROR)
    raise InputError(messages.PAGE_UNAVAILABLE)


def _read_limited(response: requests.Response, deadline: float, clock: Clock, watchdog: _Watchdog) -> bytes:
    chunks: list[bytes] = []
    total = 0
    try:
        for chunk in response.iter_content(chunk_size=CHUNK_SIZE):
            total += len(chunk)
            if total > MAX_BYTES:
                raise InputError(messages.PAGE_TOO_LARGE)
            if clock() > deadline:
                raise UpstreamTimeout(messages.PAGE_TIMEOUT)
            chunks.append(chunk)
    except (requests.exceptions.RequestException, OSError) as exc:
        if watchdog.fired or "timed out" in str(exc).lower():
            raise UpstreamTimeout(messages.PAGE_TIMEOUT) from None
        raise UpstreamError(messages.PAGE_NETWORK) from None
    if watchdog.fired:
        raise UpstreamTimeout(messages.PAGE_TIMEOUT)
    return b"".join(chunks)


def _charset(content_type: str) -> str | None:
    match = _CHARSET_RE.search(content_type)
    return match.group(1).lower() if match else None
