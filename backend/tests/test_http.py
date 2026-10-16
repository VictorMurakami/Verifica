import logging

import pytest
from fastapi.testclient import TestClient

from app.core import gateway, messages
from app.core.config import load_settings
from app.core.errors import QuotaExceeded
from app.core.gateway import fingerprint_ip
from app.main import create_app
from app.services.verifier import AnalysisOutcome

PROD = {"ENV": "production", "GATEWAY_KEY": "g" * 43, "IP_HASH_KEY": "h" * 43}
CLIENT_IP = "203.0.113.7"
HEADERS = {"X-Verifica-Gateway-Key": "g" * 43, "X-Verifica-Client-Ip": CLIENT_IP}
PAYLOAD = {"requestId": "req-1", "reliabilityScore": 80, "overallVerdict": "ok", "flaggedExcerpts": [], "analyzedText": "t"}


class StubVerifier:
    def __init__(self, outcome=None, error=None):
        self.outcome = outcome or AnalysisOutcome(payload=PAYLOAD, from_cache=False)
        self.error = error
        self.calls = []

    def analyze(self, content, request_id, fingerprint, page=None):
        self.calls.append((content, request_id, fingerprint, page))
        if self.error:
            raise self.error
        return self.outcome


def make_client(tmp_path, verifier, env=None, raise_server_exceptions=True):
    settings = load_settings({"OPENROUTER_API_KEY": "sk-or-test-key", "DATA_DIR": str(tmp_path), **(env if env is not None else PROD)})
    return TestClient(create_app(settings, verifier=verifier), raise_server_exceptions=raise_server_exceptions)


def test_health_needs_no_gateway(tmp_path):
    response = make_client(tmp_path, StubVerifier()).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"X-Verifica-Gateway-Key": "errada", "X-Verifica-Client-Ip": CLIENT_IP},
        {"X-Verifica-Gateway-Key": "g" * 43},
    ],
)
def test_gateway_rejects_missing_or_wrong_credentials(tmp_path, headers):
    verifier = StubVerifier()
    response = make_client(tmp_path, verifier).post("/api/analyze", json={"content": "Notícia"}, headers=headers)
    assert response.status_code == 401
    assert response.json() == {"detail": messages.UNAUTHORIZED}
    assert verifier.calls == []


def test_success_passes_fingerprint_not_raw_ip(tmp_path):
    verifier = StubVerifier()
    response = make_client(tmp_path, verifier).post(
        "/api/analyze", json={"content": "Notícia", "id": "req-1", "inputType": "text"}, headers=HEADERS
    )
    assert response.status_code == 200
    assert response.json() == PAYLOAD
    content, request_id, fingerprint, page = verifier.calls[0]
    assert (content, request_id) == ("Notícia", "req-1")
    assert fingerprint == fingerprint_ip(CLIENT_IP, "h" * 43)
    assert CLIENT_IP not in fingerprint
    assert page is None


def test_app_error_maps_status_and_retry_after(tmp_path):
    verifier = StubVerifier(error=QuotaExceeded(messages.IP_QUOTA, retry_after=120))
    response = make_client(tmp_path, verifier).post("/api/analyze", json={"content": "Notícia"}, headers=HEADERS)
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "120"
    assert response.json() == {"detail": messages.IP_QUOTA}


@pytest.mark.parametrize(
    "body",
    [
        {"content": 123},
        {},
        {"content": "Notícia", "id": "x" * 65},
        {"content": "Notícia", "id": "linha\nforjada"},
    ],
)
def test_invalid_body_is_400(tmp_path, body):
    response = make_client(tmp_path, StubVerifier()).post("/api/analyze", json=body, headers=HEADERS)
    assert response.status_code == 400
    assert response.json() == {"detail": messages.INVALID_REQUEST}


def test_declared_body_over_limit_is_413(tmp_path):
    verifier = StubVerifier()
    body = b'{"content": "' + b"a" * 33_000 + b'"}'
    response = make_client(tmp_path, verifier).post(
        "/api/analyze", content=body, headers={**HEADERS, "Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert response.json() == {"detail": messages.REQUEST_TOO_LARGE}
    assert verifier.calls == []


def test_chunked_body_over_limit_is_413(tmp_path):
    verifier = StubVerifier()
    chunks = iter([b'{"content": "', b"a" * 20_000, b"a" * 20_000, b'"}'])
    response = make_client(tmp_path, verifier).post(
        "/api/analyze", content=chunks, headers={**HEADERS, "Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert verifier.calls == []


@pytest.mark.parametrize(("size", "status"), [(32_768, 200), (32_769, 413)])
def test_body_limit_boundary(tmp_path, size, status):
    prefix, suffix = b'{"content": "', b'"}'
    body = prefix + b"a" * (size - len(prefix) - len(suffix)) + suffix
    assert len(body) == size
    response = make_client(tmp_path, StubVerifier()).post(
        "/api/analyze", content=body, headers={**HEADERS, "Content-Type": "application/json"}
    )
    assert response.status_code == status


def test_rejections_are_logged(tmp_path, caplog):
    caplog.set_level(logging.INFO)
    client = make_client(tmp_path, StubVerifier())
    client.post("/api/analyze", json={"content": "Notícia"})
    client.post("/api/analyze", json={"content": 1}, headers=HEADERS)
    client.post("/api/analyze", content=b"x" * 40_000, headers={**HEADERS, "Content-Type": "application/json"})
    assert "gateway rejected reason=key" in caplog.text
    assert "outcome=invalid status=400" in caplog.text
    assert "outcome=too_large status=413" in caplog.text


def test_docs_disabled_in_production(tmp_path):
    client = make_client(tmp_path, StubVerifier())
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_docs_and_cors_only_in_development(tmp_path):
    client = make_client(tmp_path, StubVerifier(), env={"ENV": "development"})
    assert client.get("/openapi.json").status_code == 200
    preflight = client.options(
        "/api/analyze", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"}
    )
    assert preflight.headers.get("access-control-allow-origin") == "http://localhost:3000"
    prod_preflight = make_client(tmp_path, StubVerifier()).options(
        "/api/analyze", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"}
    )
    assert "access-control-allow-origin" not in prod_preflight.headers


def test_development_without_gateway_uses_client_host(tmp_path):
    verifier = StubVerifier()
    response = make_client(tmp_path, verifier, env={"ENV": "development"}).post(
        "/api/analyze", json={"content": "Notícia"}
    )
    assert response.status_code == 200
    assert verifier.calls[0][2] == fingerprint_ip("testclient", "development-only-ip-hash-key")


def test_unexpected_error_is_generic_500(tmp_path, caplog):
    caplog.set_level(logging.INFO)
    verifier = StubVerifier(error=RuntimeError("boom"))
    client = make_client(tmp_path, verifier, raise_server_exceptions=False)
    response = client.post("/api/analyze", json={"content": "Notícia"}, headers=HEADERS)
    assert response.status_code == 500
    assert response.json() == {"detail": messages.UNEXPECTED}
    assert "outcome=erro status=500" in caplog.text


def test_gateway_uses_constant_time_compare(tmp_path, monkeypatch):
    calls = []
    original = gateway.hmac.compare_digest

    def spy(a, b):
        calls.append((a, b))
        return original(a, b)

    monkeypatch.setattr(gateway.hmac, "compare_digest", spy)
    verifier = StubVerifier()
    response = make_client(tmp_path, verifier).post("/api/analyze", json={"content": "Notícia"}, headers=HEADERS)
    assert response.status_code == 200
    assert len(calls) == 1


def test_logs_never_contain_content_or_ip(tmp_path, caplog):
    caplog.set_level(logging.INFO)
    make_client(tmp_path, StubVerifier()).post(
        "/api/analyze", json={"content": "conteudo-secreto-123", "id": "req-1"}, headers=HEADERS
    )
    assert "analyze id=req-1" in caplog.text
    assert "conteudo-secreto-123" not in caplog.text
    assert CLIENT_IP not in caplog.text


def test_lifespan_purges_quota_and_cache_on_startup(tmp_path, monkeypatch):
    from app.services.cache import ResultCache
    from app.services.quota import QuotaStore

    calls = []
    monkeypatch.setattr(QuotaStore, "purge", lambda self: calls.append("quota"))
    monkeypatch.setattr(ResultCache, "purge", lambda self: calls.append("cache"))

    settings = load_settings({"OPENROUTER_API_KEY": "sk-or-test-key", "DATA_DIR": str(tmp_path), **PROD})
    with TestClient(create_app(settings)):
        pass
    assert calls == ["quota", "cache"]


def test_lifespan_skips_purge_for_injected_verifier(tmp_path, monkeypatch):
    from app.services.cache import ResultCache
    from app.services.quota import QuotaStore

    calls = []
    monkeypatch.setattr(QuotaStore, "purge", lambda self: calls.append("quota"))
    monkeypatch.setattr(ResultCache, "purge", lambda self: calls.append("cache"))

    with make_client(tmp_path, StubVerifier()):
        pass
    assert calls == []


PAGE_HEADERS = {
    **HEADERS,
    "X-Verifica-Source-Url": "https://news.example/a",
    "X-Verifica-Page-Url": "https://news.example/a/",
    "X-Verifica-Page-Charset": "iso-8859-1",
    "X-Verifica-Request-Id": "req-9",
    "Content-Type": "application/octet-stream",
}


def test_analyze_page_happy_path(tmp_path):
    verifier = StubVerifier()
    response = make_client(tmp_path, verifier).post(
        "/api/analyze-page", content=b"<html>pagina</html>", headers=PAGE_HEADERS
    )
    assert response.status_code == 200
    assert response.json() == PAYLOAD
    content, request_id, fingerprint, page = verifier.calls[0]
    assert content == "https://news.example/a"
    assert request_id == "req-9"
    assert fingerprint == fingerprint_ip(CLIENT_IP, "h" * 43)
    assert page.url == "https://news.example/a/"
    assert page.content == b"<html>pagina</html>"
    assert page.charset == "iso-8859-1"


def test_analyze_page_requires_gateway(tmp_path):
    verifier = StubVerifier()
    response = make_client(tmp_path, verifier).post(
        "/api/analyze-page",
        content=b"<html></html>",
        headers={
            "X-Verifica-Source-Url": "https://news.example/a",
            "X-Verifica-Page-Url": "https://news.example/a",
        },
    )
    assert response.status_code == 401
    assert verifier.calls == []


@pytest.mark.parametrize(
    "bad_source", ["not-a-url", "", "ftp://news.example/a", "https://news.example/" + "a" * 2048]
)
def test_analyze_page_rejects_invalid_source_url(tmp_path, bad_source):
    verifier = StubVerifier()
    headers = {**PAGE_HEADERS, "X-Verifica-Source-Url": bad_source}
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=b"<html></html>", headers=headers)
    assert response.status_code == 400
    assert response.json() == {"detail": messages.INVALID_REQUEST}
    assert verifier.calls == []


@pytest.mark.parametrize("bad_page_url", ["not-a-url", "", "ftp://news.example/a"])
def test_analyze_page_rejects_invalid_page_url(tmp_path, bad_page_url):
    verifier = StubVerifier()
    headers = {**PAGE_HEADERS, "X-Verifica-Page-Url": bad_page_url}
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=b"<html></html>", headers=headers)
    assert response.status_code == 400
    assert response.json() == {"detail": messages.INVALID_REQUEST}
    assert verifier.calls == []


def test_analyze_page_ignores_invalid_charset_and_request_id(tmp_path):
    verifier = StubVerifier()
    headers = {**PAGE_HEADERS, "X-Verifica-Page-Charset": "bad charset!", "X-Verifica-Request-Id": "linha\nforjada"}
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=b"<html></html>", headers=headers)
    assert response.status_code == 200
    _, request_id, _, page = verifier.calls[0]
    assert request_id is None
    assert page.charset is None


def test_analyze_page_body_over_1mib_is_413(tmp_path):
    verifier = StubVerifier()
    body = b"a" * (1_048_576 + 1)
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=body, headers=PAGE_HEADERS)
    assert response.status_code == 413
    assert verifier.calls == []


def test_analyze_page_body_at_1mib_is_accepted(tmp_path):
    verifier = StubVerifier()
    body = b"a" * 1_048_576
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=body, headers=PAGE_HEADERS)
    assert response.status_code == 200


def test_analyze_is_still_limited_to_32kib_after_page_route_exists(tmp_path):
    verifier = StubVerifier()
    body = b'{"content": "' + b"a" * 33_000 + b'"}'
    response = make_client(tmp_path, verifier).post(
        "/api/analyze", content=body, headers={**HEADERS, "Content-Type": "application/json"}
    )
    assert response.status_code == 413


def test_analyze_page_invalid_header_is_logged(tmp_path, caplog):
    caplog.set_level(logging.INFO)
    verifier = StubVerifier()
    headers = {**PAGE_HEADERS, "X-Verifica-Source-Url": "not-a-url"}
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=b"<html></html>", headers=headers)
    assert response.status_code == 400
    assert response.json() == {"detail": messages.INVALID_REQUEST}
    assert "outcome=erro status=400" in caplog.text


def test_analyze_page_disconnect_is_logged_without_traceback(tmp_path, monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    from starlette.requests import ClientDisconnect, Request

    async def raise_disconnect(self):
        raise ClientDisconnect()

    monkeypatch.setattr(Request, "body", raise_disconnect)
    verifier = StubVerifier()
    response = make_client(tmp_path, verifier).post(
        "/api/analyze-page", content=b"<html></html>", headers=PAGE_HEADERS
    )
    assert response.status_code == 400
    assert response.json() == {"detail": messages.INVALID_REQUEST}
    assert "outcome=disconnect status=400" in caplog.text
    assert "Traceback" not in caplog.text
    assert verifier.calls == []


@pytest.mark.parametrize(
    "bad_url",
    [
        "https://ex ample.com/a",
        "https://ex.example/\x01",
        "https://ex.example\\@evil.example/",
        "https://user:pw@ex.example/",
        "http://localhost/",
        "http://192.168.0.1/",
        "http://[::1]/",
    ],
)
def test_analyze_page_rejects_hardened_source_url(tmp_path, bad_url):
    verifier = StubVerifier()
    headers = {**PAGE_HEADERS, "X-Verifica-Source-Url": bad_url}
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=b"<html></html>", headers=headers)
    assert response.status_code == 400
    assert response.json() == {"detail": messages.INVALID_REQUEST}
    assert verifier.calls == []


@pytest.mark.parametrize(
    "bad_url",
    [
        "https://ex ample.com/a",
        "https://ex.example/\x01",
        "https://ex.example\\@evil.example/",
        "https://user:pw@ex.example/",
        "http://localhost/",
        "http://192.168.0.1/",
        "http://[::1]/",
    ],
)
def test_analyze_page_rejects_hardened_page_url(tmp_path, bad_url):
    verifier = StubVerifier()
    headers = {**PAGE_HEADERS, "X-Verifica-Page-Url": bad_url}
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=b"<html></html>", headers=headers)
    assert response.status_code == 400
    assert response.json() == {"detail": messages.INVALID_REQUEST}
    assert verifier.calls == []


@pytest.mark.parametrize(
    "bad_url",
    [
        "http://1.2.3.4./",
        "http://127.1/",
        "http://0x7f.0.0.1/",
        "http://0177.0.0.1/",
        "http://localhost./",
    ],
)
def test_analyze_page_rejects_non_canonical_ip_literal_source_url(tmp_path, bad_url):
    verifier = StubVerifier()
    headers = {**PAGE_HEADERS, "X-Verifica-Source-Url": bad_url}
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=b"<html></html>", headers=headers)
    assert response.status_code == 400
    assert response.json() == {"detail": messages.INVALID_REQUEST}
    assert verifier.calls == []


def test_analyze_page_accepts_backslash_outside_host(tmp_path):
    verifier = StubVerifier()
    headers = {
        **PAGE_HEADERS,
        "X-Verifica-Source-Url": "https://ex.example/?a=\\b",
        "X-Verifica-Page-Url": "https://ex.example/?a=\\b",
    }
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=b"<html></html>", headers=headers)
    assert response.status_code == 200


def test_analyze_page_accepts_trailing_dot_fqdn_source_url(tmp_path):
    verifier = StubVerifier()
    headers = {**PAGE_HEADERS, "X-Verifica-Source-Url": "https://g1.globo.com./x"}
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=b"<html></html>", headers=headers)
    assert response.status_code == 200


def test_analyze_page_large_chunked_body_over_limit_is_413_without_500_log(tmp_path, caplog):
    caplog.set_level(logging.INFO)
    verifier = StubVerifier()
    chunks = iter([b"a" * 600_000, b"a" * 600_000])
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=chunks, headers=PAGE_HEADERS)
    assert response.status_code == 413
    assert "status=500" not in caplog.text
    assert verifier.calls == []


def test_analyze_url_is_blocked_in_production_without_fetch_or_llm(tmp_path, monkeypatch):
    from app.services import verifier
    from app.services.llm import LlmClient

    def fail_if_called(*args, **kwargs):
        pytest.fail("não deveria buscar a URL nem chamar o LLM em produção")

    monkeypatch.setattr(verifier, "extract_text_from_url", fail_if_called)
    monkeypatch.setattr(LlmClient, "analyze", fail_if_called)

    settings = load_settings({"OPENROUTER_API_KEY": "sk-or-test-key", "DATA_DIR": str(tmp_path), **PROD})
    client = TestClient(create_app(settings))
    response = client.post("/api/analyze", json={"content": "https://news.example/materia"}, headers=HEADERS)
    assert response.status_code == 400
    assert response.json() == {"detail": messages.URL_BLOCKED}


def test_analyze_page_invalid_header_does_not_read_body(tmp_path, monkeypatch):
    from starlette.requests import Request

    async def fail_if_called(self):
        pytest.fail("corpo não deveria ser lido com header inválido")

    monkeypatch.setattr(Request, "body", fail_if_called)
    verifier = StubVerifier()
    headers = {**PAGE_HEADERS, "X-Verifica-Source-Url": "not-a-url"}
    chunks = iter([b"a" * 600_000, b"a" * 600_000])
    response = make_client(tmp_path, verifier).post("/api/analyze-page", content=chunks, headers=headers)
    assert response.status_code == 400
    assert verifier.calls == []
