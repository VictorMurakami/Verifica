import gzip
import socket
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
import requests
from requests.structures import CaseInsensitiveDict

from app.core import messages
from app.core.errors import InputError, UpstreamError, UpstreamTimeout
from app.services import safe_fetch
from app.services.safe_fetch import fetch_html, is_public_ip, new_session, validate_url

PUBLIC_IP = "1.1.1.1"
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
LOCALHOST_CERT = FIXTURES_DIR / "localhost.crt"
LOCALHOST_KEY = FIXTURES_DIR / "localhost.key"


def resolver_for(mapping):
    def resolve(host, port):
        if host not in mapping:
            raise socket.gaierror("host desconhecido")
        return mapping[host]

    return resolve


NEWS = resolver_for({"news.example": [PUBLIC_IP], "other.example": [PUBLIC_IP]})


class FakeResponse:
    def __init__(self, status=200, headers=None, chunks=(b"<html>ok</html>",)):
        self.status_code = status
        self.headers = CaseInsensitiveDict(headers or {"Content-Type": "text/html; charset=utf-8"})
        self._chunks = chunks
        self.closed = False

    @property
    def is_redirect(self):
        return "location" in self.headers and self.status_code in (301, 302, 303, 307, 308)

    def iter_content(self, chunk_size=1):
        yield from self._chunks

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class FakeSession:
    def __init__(self, responses):
        self.responses = dict(responses)
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        result = self.responses[url]
        if isinstance(result, Exception):
            raise result
        return result


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://127.1/",
        "http://0x7f.1/",
        "http://3232235777/",
        "http://192.168.1.1/",
        "http://10.0.0.5/",
        "http://100.64.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://0.0.0.0/",
        "http://[::1]/",
        "http://[::ffff:192.168.0.1]/",
    ],
)
def test_private_and_obfuscated_ips_are_blocked(url):
    with pytest.raises(InputError) as exc:
        validate_url(url)
    assert exc.value.message == messages.URL_BLOCKED


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://news.example/a",
        "gopher://news.example/a",
        "http://user:senha@news.example/a",
        "http://news.example:8123/a",
        "http:///sem-host",
    ],
)
def test_disallowed_url_shapes_are_blocked(url):
    with pytest.raises(InputError) as exc:
        validate_url(url, NEWS)
    assert exc.value.message == messages.URL_BLOCKED


def test_host_resolving_to_private_ip_is_blocked():
    with pytest.raises(InputError) as exc:
        validate_url("https://evil.example/a", resolver_for({"evil.example": ["192.168.1.50"]}))
    assert exc.value.message == messages.URL_BLOCKED


def test_any_private_address_blocks_the_host():
    with pytest.raises(InputError):
        validate_url("https://mixed.example/a", resolver_for({"mixed.example": [PUBLIC_IP, "10.0.0.1"]}))


def test_unknown_host_reports_unreachable():
    with pytest.raises(InputError) as exc:
        validate_url("https://nao-existe.example/a", NEWS)
    assert exc.value.message == messages.URL_UNREACHABLE


def test_public_host_is_accepted():
    assert validate_url("https://news.example/a", NEWS) == "news.example"
    assert is_public_ip(PUBLIC_IP) is True
    assert is_public_ip("not-an-ip") is False


def test_fetch_returns_page_and_disables_auto_redirect():
    session = FakeSession({"https://news.example/a": FakeResponse(chunks=(b"<html>", b"ok</html>"))})
    page = fetch_html("https://news.example/a", session=session, resolver=NEWS)
    assert page.url == "https://news.example/a"
    assert page.content == b"<html>ok</html>"
    assert page.charset == "utf-8"
    _, kwargs = session.calls[0]
    assert kwargs["allow_redirects"] is False
    assert kwargs["stream"] is True
    assert kwargs["timeout"][0] == safe_fetch.CONNECT_TIMEOUT_SECONDS


def test_redirect_to_private_ip_is_blocked_before_request():
    session = FakeSession(
        {"https://news.example/a": FakeResponse(302, {"Location": "http://192.168.1.1/admin"})}
    )
    with pytest.raises(InputError) as exc:
        fetch_html("https://news.example/a", session=session, resolver=NEWS)
    assert exc.value.message == messages.URL_BLOCKED
    assert len(session.calls) == 1


def test_relative_redirect_is_followed_and_revalidated():
    session = FakeSession(
        {
            "https://news.example/a": FakeResponse(301, {"Location": "/b"}),
            "https://news.example/b": FakeResponse(),
        }
    )
    page = fetch_html("https://news.example/a", session=session, resolver=NEWS)
    assert page.url == "https://news.example/b"


def test_too_many_redirects():
    session = FakeSession(
        {f"https://news.example/{i}": FakeResponse(302, {"Location": f"/{i + 1}"}) for i in range(5)}
    )
    with pytest.raises(InputError) as exc:
        fetch_html("https://news.example/0", session=session, resolver=NEWS)
    assert exc.value.message == messages.PAGE_TOO_MANY_REDIRECTS
    assert len(session.calls) == safe_fetch.MAX_REDIRECTS + 1


def test_body_over_limit_is_refused():
    big = b"x" * (1024 * 1024)
    session = FakeSession({"https://news.example/a": FakeResponse(chunks=(big, big, b"x"))})
    with pytest.raises(InputError) as exc:
        fetch_html("https://news.example/a", session=session, resolver=NEWS)
    assert exc.value.message == messages.PAGE_TOO_LARGE


def test_non_html_is_refused():
    session = FakeSession({"https://news.example/a": FakeResponse(headers={"Content-Type": "application/pdf"})})
    with pytest.raises(InputError) as exc:
        fetch_html("https://news.example/a", session=session, resolver=NEWS)
    assert exc.value.message == messages.PAGE_NOT_HTML


@pytest.mark.parametrize(
    ("status", "error", "message"),
    [
        (403, InputError, messages.PAGE_FORBIDDEN),
        (404, InputError, messages.PAGE_NOT_FOUND),
        (410, InputError, messages.PAGE_UNAVAILABLE),
        (429, UpstreamError, messages.PAGE_RATE_LIMITED),
        (503, UpstreamError, messages.PAGE_SERVER_ERROR),
    ],
)
def test_status_mapping(status, error, message):
    session = FakeSession({"https://news.example/a": FakeResponse(status)})
    with pytest.raises(error) as exc:
        fetch_html("https://news.example/a", session=session, resolver=NEWS)
    assert exc.value.message == message


@pytest.mark.parametrize(
    ("failure", "error", "message"),
    [
        (requests.exceptions.ConnectTimeout(), UpstreamTimeout, messages.PAGE_TIMEOUT),
        (requests.exceptions.SSLError(), InputError, messages.PAGE_SSL),
        (requests.exceptions.ConnectionError(), UpstreamError, messages.PAGE_CONNECTION),
        (requests.exceptions.InvalidHeader(), UpstreamError, messages.PAGE_NETWORK),
    ],
)
def test_network_failures(failure, error, message):
    session = FakeSession({"https://news.example/a": failure})
    with pytest.raises(error) as exc:
        fetch_html("https://news.example/a", session=session, resolver=NEWS)
    assert exc.value.message == message


def test_total_deadline_is_enforced_while_reading():
    ticks = iter([0.0, 1.0, 11.0])
    session = FakeSession({"https://news.example/a": FakeResponse(chunks=(b"a", b"b"))})
    with pytest.raises(UpstreamTimeout):
        fetch_html("https://news.example/a", session=session, resolver=NEWS, clock=lambda: next(ticks))


def test_session_ignores_environment_proxies():
    session = new_session()
    assert session.trust_env is False
    assert isinstance(session.get_adapter("https://news.example/"), safe_fetch._SafeAdapter)


def test_blocked_urls_are_logged(caplog):
    caplog.set_level("WARNING")
    with pytest.raises(InputError):
        validate_url("http://localhost:8123/", NEWS)
    assert "blocked host='localhost'" in caplog.text


def test_nat64_addresses_are_not_public():
    assert is_public_ip("64:ff9b::c0a8:101") is False


@pytest.fixture
def local_server(monkeypatch):
    monkeypatch.setattr(safe_fetch, "validate_url", lambda url, resolver=None: "127.0.0.1")
    monkeypatch.setattr(safe_fetch, "is_public_ip", lambda address: True)
    servers = []

    def start(handler):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        return f"http://127.0.0.1:{server.server_port}/"

    yield start
    for server in servers:
        server.shutdown()


@pytest.fixture
def local_tls_server(monkeypatch):
    monkeypatch.setattr(safe_fetch, "validate_url", lambda url, resolver=None: "127.0.0.1")
    monkeypatch.setattr(safe_fetch, "is_public_ip", lambda address: True)
    servers = []

    def start(handler):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(str(LOCALHOST_CERT), str(LOCALHOST_KEY))
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        return f"https://localhost:{server.server_port}/"

    yield start
    for server in servers:
        server.shutdown()


class QuietHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_html_headers(self, length, encoding=None):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        if encoding:
            self.send_header("Content-Encoding", encoding)
        self.send_header("Content-Length", str(length))
        self.end_headers()


def test_gzip_bomb_is_capped(local_server):
    payload = gzip.compress(b"<html>" + b"a" * (3 * 1024 * 1024) + b"</html>")

    class Handler(QuietHandler):
        def do_GET(self):
            self.send_html_headers(len(payload), "gzip")
            self.wfile.write(payload)

    with pytest.raises(InputError) as exc:
        fetch_html(local_server(Handler))
    assert exc.value.message == messages.PAGE_TOO_LARGE


def test_slow_drip_respects_total_deadline(local_server, monkeypatch):
    monkeypatch.setattr(safe_fetch, "TOTAL_DEADLINE_SECONDS", 1.5)

    class Handler(QuietHandler):
        def do_GET(self):
            self.send_html_headers(100)
            try:
                for _ in range(100):
                    self.wfile.write(b"a")
                    self.wfile.flush()
                    time.sleep(0.2)
            except OSError:
                pass

    started = time.monotonic()
    with pytest.raises(UpstreamTimeout):
        fetch_html(local_server(Handler))
    assert time.monotonic() - started < 4


def test_stalled_body_is_timeout(local_server, monkeypatch):
    monkeypatch.setattr(safe_fetch, "TOTAL_DEADLINE_SECONDS", 1.0)

    class Handler(QuietHandler):
        def do_GET(self):
            self.send_html_headers(1000)
            self.wfile.write(b"<html>" + b"a" * 10)
            self.wfile.flush()
            time.sleep(5)

    with pytest.raises(UpstreamTimeout):
        fetch_html(local_server(Handler))


@pytest.mark.parametrize("case", ["bad-gzip", "truncated"])
def test_broken_bodies_are_upstream_errors(local_server, case):
    class Handler(QuietHandler):
        def do_GET(self):
            if case == "bad-gzip":
                body = b"isto nao e gzip"
                self.send_html_headers(len(body), "gzip")
                self.wfile.write(body)
            else:
                self.send_html_headers(1000)
                self.wfile.write(b"<html>" + b"a" * 10)

    with pytest.raises(UpstreamError) as exc:
        fetch_html(local_server(Handler))
    assert exc.value.message == messages.PAGE_NETWORK


def test_dns_rebinding_is_blocked_at_connect(monkeypatch):
    hits = [0]

    class Handler(QuietHandler):
        def do_GET(self):
            hits[0] += 1
            self.send_html_headers(2)
            self.wfile.write(b"ok")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port
    try:
        monkeypatch.setattr(safe_fetch, "ALLOWED_PORTS", frozenset({80, 443, port}))
        resolver = resolver_for({"localhost": ["1.1.1.1"]})
        with pytest.raises(InputError) as exc:
            fetch_html(f"http://localhost:{port}/", resolver=resolver)
        assert exc.value.message == messages.URL_BLOCKED
        assert hits[0] == 0
    finally:
        server.shutdown()


def test_slow_headers_respect_total_deadline(local_server, monkeypatch):
    monkeypatch.setattr(safe_fetch, "TOTAL_DEADLINE_SECONDS", 1.5)

    class Handler(QuietHandler):
        def do_GET(self):
            try:
                for byte in b"HTTP/1.0 200 OK\r\n":
                    self.wfile.write(bytes([byte]))
                    self.wfile.flush()
                    time.sleep(0.3)
            except OSError:
                pass

    started = time.monotonic()
    with pytest.raises(UpstreamTimeout):
        fetch_html(local_server(Handler))
    assert time.monotonic() - started < 4


def test_https_slow_headers_respect_total_deadline(local_tls_server, monkeypatch):
    monkeypatch.setattr(safe_fetch, "TOTAL_DEADLINE_SECONDS", 1.5)

    class Handler(QuietHandler):
        def do_GET(self):
            try:
                for byte in b"HTTP/1.0 200 OK\r\n":
                    self.wfile.write(bytes([byte]))
                    self.wfile.flush()
                    time.sleep(0.3)
            except OSError:
                pass

    session = new_session()
    session.verify = str(LOCALHOST_CERT)
    started = time.monotonic()
    with pytest.raises(UpstreamTimeout):
        fetch_html(local_tls_server(Handler), session=session)
    assert time.monotonic() - started < 4


def test_https_slow_body_respects_total_deadline(local_tls_server, monkeypatch):
    monkeypatch.setattr(safe_fetch, "TOTAL_DEADLINE_SECONDS", 1.5)

    class Handler(QuietHandler):
        def do_GET(self):
            self.send_html_headers(100)
            try:
                for _ in range(100):
                    self.wfile.write(b"a")
                    self.wfile.flush()
                    time.sleep(0.2)
            except OSError:
                pass

    session = new_session()
    session.verify = str(LOCALHOST_CERT)
    started = time.monotonic()
    with pytest.raises(UpstreamTimeout):
        fetch_html(local_tls_server(Handler), session=session)
    assert time.monotonic() - started < 4


def test_https_dns_rebinding_is_blocked_before_tls(monkeypatch):
    hits = [0]
    handshakes = [0]

    class Handler(QuietHandler):
        def do_GET(self):
            hits[0] += 1
            self.send_html_headers(2)
            self.wfile.write(b"ok")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(LOCALHOST_CERT), str(LOCALHOST_KEY))

    def sni_callback(sock, server_name, context):
        handshakes[0] += 1

    ctx.sni_callback = sni_callback
    server.socket = ctx.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_port
    try:
        monkeypatch.setattr(safe_fetch, "ALLOWED_PORTS", frozenset({80, 443, port}))
        resolver = resolver_for({"localhost": ["1.1.1.1"]})
        session = new_session()
        session.verify = str(LOCALHOST_CERT)
        with pytest.raises(InputError) as exc:
            fetch_html(f"https://localhost:{port}/", session=session, resolver=resolver)
        assert exc.value.message == messages.URL_BLOCKED
        assert hits[0] == 0
        assert handshakes[0] == 0
    finally:
        server.shutdown()
