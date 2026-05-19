from __future__ import annotations

from urllib.parse import urlparse

from app.services.llm import analisar_texto, CATEGORIAS
from app.services.scraper import extract_text_from_url


def _is_url(value: str) -> bool:
    if not value:
        return False
    try:
        parsed = urlparse(value.strip())
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def _clamp_score(value) -> int:
    try:
        n = int(round(float(value)))
    except Exception:
        return 5
    return max(0, min(100, n))


def _normalize_excerpts(raw):
    if not isinstance(raw, list):
        return []

    out = []
    for item in raw[:5]:
        if not isinstance(item, dict):
            continue
        category = item.get("category")
        if category not in CATEGORIAS:
            continue
        excerpt = str(item.get("excerpt", "")).strip()[:240]
        if not excerpt:
            continue
        out.append({
            "excerpt": excerpt,
            "reason": str(item.get("reason", "")).strip(),
            "category": category,
            "suggestion": str(item.get("suggestion", "")).strip(),
        })
    return out


def verificar(content: str | None, url: str | None = None, request_id: str | None = None) -> dict:
    """Pipeline principal de análise.

    Recebe `content` (texto OU URL — o frontend manda tudo neste campo)
    e opcionalmente `url` explícito. Detecta automaticamente se o
    conteúdo é uma URL e extrai o texto antes de chamar o LLM.

    Retorna um dict no schema do frontend ou levanta ValueError com
    mensagem amigável quando a análise não pôde ser feita.
    """

    texto = (content or "").strip()
    origem_url = (url or "").strip() or None

    if not origem_url and _is_url(texto):
        origem_url = texto
        texto = ""

    if not texto and not origem_url:
        raise ValueError("Cole um texto ou link para que possamos analisar.")

    contexto = ""
    if origem_url:
        contexto, erro = extract_text_from_url(origem_url)
        if erro:
            raise ValueError(erro)

    resultado = analisar_texto(
        texto=texto,
        contexto=contexto,
        origem_url=origem_url,
    )

    if "error" in resultado:
        raise ValueError(resultado["error"])

    score = _clamp_score(resultado.get("score"))
    verdict = str(resultado.get("verdict", "")).strip()
    excerpts = _normalize_excerpts(resultado.get("excerpts"))

    analyzed_text = texto or contexto

    return {
        "requestId": request_id or "",
        "reliabilityScore": score,
        "overallVerdict": verdict,
        "flaggedExcerpts": excerpts,
        "analyzedText": analyzed_text,
    }
