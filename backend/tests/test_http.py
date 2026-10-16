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

    def analyze(self, content, request_id, fingerprint):
        self.calls.append((content, request_id, fingerprint))
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
    content, request_id, fingerprint = verifier.calls[0]
    assert (content, request_id) == ("Notícia", "req-1")
    assert fingerprint == fingerprint_ip(CLIENT_IP, "h" * 43)
    assert CLIENT_IP not in fingerprint


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
