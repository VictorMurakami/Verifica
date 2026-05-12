from __future__ import annotations

import logging

import requests
import trafilatura
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}

MAX_CHARS = 6000
MIN_USABLE_CHARS = 80

GENERIC_FAIL = (
    "Não conseguimos ler o conteúdo desta página. "
    "Tente colar o texto da notícia diretamente."
)


def _extract_with_trafilatura(html: str, url: str) -> str:
    try:
        text = trafilatura.extract(
            html,
            url=url,
            include_comments=False,
            include_tables=False,
            favor_recall=True,
            deduplicate=True,
        )
        return (text or "").strip()
    except Exception as e:
        logger.debug("trafilatura falhou: %s", e)
        return ""


def _extract_with_bs4(html: str) -> str:
    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception as e:
        logger.debug("bs4 parse falhou: %s", e)
        return ""

    for tag in soup(["script", "style", "noscript", "nav", "header",
                     "footer", "aside", "form", "iframe", "svg"]):
        tag.decompose()

    for selector in ("article", "main", "[role='main']", ".article-body",
                     ".post-content", ".entry-content", ".content",
                     "#content", "#main"):
        node = soup.select_one(selector)
        if not node:
            continue
        text = node.get_text(" ", strip=True)
        if len(text) >= MIN_USABLE_CHARS:
            return text

    paragraphs = [p.get_text(strip=True) for p in soup.find_all("p")]
    text = " ".join(p for p in paragraphs if p)
    if len(text) >= MIN_USABLE_CHARS:
        return text

    body = soup.find("body")
    if body:
        return body.get_text(" ", strip=True)

    return ""


def extract_text_from_url(url: str) -> tuple[str, str | None]:
    """Baixa o HTML da URL e devolve (texto, erro_amigavel).

    - Sucesso → (texto, None).
    - Falha → ("", mensagem amigável para o usuário).
    """

    try:
        response = requests.get(url, timeout=10, headers=HEADERS, allow_redirects=True)
    except requests.exceptions.Timeout:
        return "", "A página demorou demais para responder. Tente novamente."
    except requests.exceptions.SSLError:
        return "", "Esta página tem um problema de segurança e não pôde ser aberta."
    except requests.exceptions.ConnectionError:
        return "", "Não conseguimos nos conectar a este link. Verifique se o endereço está correto."
    except requests.exceptions.RequestException as e:
        logger.debug("erro de rede: %s", e)
        return "", "Não conseguimos acessar este link agora."

    status = response.status_code
    if status >= 400:
        if status in (401, 403):
            return "", (
                "Esta página bloqueou nosso acesso. "
                "Cole o texto da notícia diretamente para analisar."
            )
        if status == 404:
            return "", "A página não foi encontrada. Verifique o link."
        if status == 429:
            return "", "O site está limitando acessos no momento. Tente novamente em instantes."
        if 500 <= status < 600:
            return "", "O site da notícia está fora do ar agora. Tente mais tarde."
        return "", "Esta página não pôde ser aberta no momento."

    html = response.text or ""
    if not html.strip():
        return "", GENERIC_FAIL

    text = _extract_with_trafilatura(html, url)
    if len(text) < MIN_USABLE_CHARS:
        fallback = _extract_with_bs4(html)
        if len(fallback) > len(text):
            text = fallback

    if len(text) < MIN_USABLE_CHARS:
        logger.info(
            "extração insuficiente para %s (status=%s, html=%d, extraído=%d)",
            url, status, len(html), len(text),
        )
        return "", GENERIC_FAIL

    return text[:MAX_CHARS], None
