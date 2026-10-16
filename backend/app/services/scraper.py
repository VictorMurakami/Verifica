from __future__ import annotations

import logging
from typing import Callable

import trafilatura
from bs4 import BeautifulSoup

from app.core import messages
from app.core.errors import InputError
from app.services.safe_fetch import FetchedPage, fetch_html

logger = logging.getLogger(__name__)

MAX_CHARS = 15000
MIN_USABLE_CHARS = 80


def _extract_with_trafilatura(html: str | bytes, url: str) -> str:
    try:
        text = trafilatura.extract(
            html,
            url=url,
            include_comments=False,
            include_tables=False,
            include_formatting=False,
            include_images=False,
            include_links=False,
            favor_recall=True,
            deduplicate=False,
            output_format="txt",
        )
        return (text or "").strip()
    except Exception as e:
        logger.debug("trafilatura falhou: %s", e)
        return ""


def _extract_with_bs4(html: str | bytes) -> str:
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


def _markup(page: FetchedPage) -> str | bytes:
    # Sem charset no header, bytes deixam trafilatura/bs4 lerem o <meta charset>.
    if page.charset:
        try:
            return page.content.decode(page.charset, errors="replace")
        except LookupError:
            pass
    return page.content


def extract_text_from_url(url: str, fetch: Callable[[str], FetchedPage] = fetch_html) -> str:
    page = fetch(url)
    markup = _markup(page)

    trafi = _extract_with_trafilatura(markup, page.url)
    bs4 = _extract_with_bs4(markup)

    # Prefere trafilatura (mais limpo); bs4 bem maior indica corpo perdido.
    if len(bs4) > len(trafi) * 1.3:
        text, chosen = bs4, "bs4"
    else:
        text, chosen = (trafi, "trafilatura") if trafi else (bs4, "bs4")

    logger.info(
        "extração %s (bytes=%d, trafi=%d, bs4=%d, final=%d)",
        chosen, len(page.content), len(trafi), len(bs4), len(text),
    )

    if len(text) < MIN_USABLE_CHARS:
        raise InputError(messages.PAGE_UNREADABLE)

    return text[:MAX_CHARS]
