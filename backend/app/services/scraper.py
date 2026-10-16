from __future__ import annotations

import codecs
import logging
import re
from typing import Callable

import trafilatura
from bs4 import BeautifulSoup

from app.core import messages
from app.core.errors import InputError
from app.services.safe_fetch import FetchedPage, fetch_html

logger = logging.getLogger(__name__)

MAX_CHARS = 15000
MIN_USABLE_CHARS = 80
MAX_TAGS = 40_000
MAX_TAG_BYTES = 16_384
_LONG_TAG_RE = re.compile(rb"<[^>]{16384,}")

# Charsets que sabemos decodificar sem ambiguidade; qualquer outro nome
# (inclusive aliases exóticos como punycode/idna) cai no sniff de <meta charset>.
_ALLOWED_CHARSETS = frozenset(
    {"utf-8", "iso8859-1", "cp1252", "iso8859-15", "ascii", "utf-16-le", "utf-16-be"}
)


def _normalize_charset(charset: str) -> str | None:
    try:
        name = codecs.lookup(charset).name
    except LookupError:
        return None
    return name if name in _ALLOWED_CHARSETS else None


def _extract_with_trafilatura(html: str | bytes) -> str:
    try:
        text = trafilatura.extract(
            html,
            url=None,
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
        soup = BeautifulSoup(html, "lxml")
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
    # Sem charset reconhecido, bytes deixam trafilatura/bs4 lerem o <meta charset>.
    if page.charset:
        name = _normalize_charset(page.charset)
        if name:
            try:
                return page.content.decode(name, errors="replace")
            except (LookupError, UnicodeError):
                pass
    return page.content


def extract_text(page: FetchedPage) -> str:
    tag_count = page.content.count(b"<")
    if tag_count > MAX_TAGS or _LONG_TAG_RE.search(page.content):
        logger.info("página recusada por complexidade (tags=%d)", tag_count)
        raise InputError(messages.PAGE_TOO_LARGE)

    markup = _markup(page)

    trafi = _extract_with_trafilatura(markup)
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


def extract_text_from_url(url: str, fetch: Callable[[str], FetchedPage] = fetch_html) -> str:
    return extract_text(fetch(url))
