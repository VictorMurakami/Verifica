import logging
import time

import pytest

from app.core import messages
from app.core.errors import InputError
from app.services.safe_fetch import FetchedPage
from app.services.scraper import _markup, extract_text, extract_text_from_url

PARAGRAPH = "A população recebeu a informação oficial do ministério sobre a vacinação. "


def page(html: str, encoding: str, charset: str | None) -> FetchedPage:
    return FetchedPage(url="https://news.example/a", content=html.encode(encoding), charset=charset)


def test_meta_charset_without_header_is_decoded():
    html = (
        '<html><head><meta charset="iso-8859-1"></head><body><article><p>'
        + PARAGRAPH * 10
        + "</p></article></body></html>"
    )
    text = extract_text_from_url("https://news.example/a", fetch=lambda url: page(html, "latin-1", None))
    assert "população" in text
    assert "informação" in text


def test_header_charset_is_used():
    html = "<html><body><article><p>" + PARAGRAPH * 10 + "</p></article></body></html>"
    text = extract_text_from_url("https://news.example/a", fetch=lambda url: page(html, "utf-8", "utf-8"))
    assert "vacinação" in text


def test_short_page_is_unreadable():
    html = "<html><body><p>curto</p></body></html>"
    with pytest.raises(InputError) as exc:
        extract_text_from_url("https://news.example/a", fetch=lambda url: page(html, "utf-8", "utf-8"))
    assert exc.value.message == messages.PAGE_UNREADABLE


def test_text_is_capped():
    html = "<html><body><article><p>" + PARAGRAPH * 500 + "</p></article></body></html>"
    text = extract_text_from_url("https://news.example/a", fetch=lambda url: page(html, "utf-8", "utf-8"))
    assert len(text) <= 15000


def test_success_log_does_not_include_host(caplog):
    caplog.set_level("INFO")
    html = "<html><body><article><p>" + PARAGRAPH * 10 + "</p></article></body></html>"
    extract_text_from_url("https://news.example/a", fetch=lambda url: page(html, "utf-8", "utf-8"))
    assert "news.example" not in caplog.text


def test_extract_text_takes_a_fetched_page_directly():
    html = "<html><body><article><p>" + PARAGRAPH * 10 + "</p></article></body></html>"
    text = extract_text(page(html, "utf-8", "utf-8"))
    assert "vacinação" in text


def test_extract_text_from_url_delegates_to_extract_text():
    html = "<html><body><article><p>" + PARAGRAPH * 10 + "</p></article></body></html>"
    calls = []

    def fetch(url):
        calls.append(url)
        return page(html, "utf-8", "utf-8")

    text = extract_text_from_url("https://news.example/a", fetch=fetch)
    assert calls == ["https://news.example/a"]
    assert extract_text(page(html, "utf-8", "utf-8")) == text


def test_bs4_extraction_is_fast_for_many_paragraphs():
    html = "<html><body>" + "<p>a" * 20000 + "</body></html>"
    started = time.monotonic()
    extract_text(page(html, "utf-8", "utf-8"))
    elapsed = time.monotonic() - started
    assert elapsed < 2.0


def test_too_many_tags_is_rejected_quickly():
    html = "<html><body>" + "<p>a" * 262000 + "</body></html>"  # ~1 MiB
    started = time.monotonic()
    with pytest.raises(InputError) as exc:
        extract_text(page(html, "utf-8", "utf-8"))
    elapsed = time.monotonic() - started
    assert exc.value.message == messages.PAGE_TOO_LARGE
    assert elapsed < 1.0


def test_single_oversized_tag_is_rejected_quickly():
    attrs = " ".join(f"a{i}=x" for i in range(125000))
    html = f"<html><body><p {attrs}>texto</p></body></html>"
    started = time.monotonic()
    with pytest.raises(InputError) as exc:
        extract_text(page(html, "utf-8", "utf-8"))
    elapsed = time.monotonic() - started
    assert exc.value.message == messages.PAGE_TOO_LARGE
    assert elapsed < 1.0


def test_page_with_many_short_elements_still_extracts():
    html = (
        "<html><body>"
        + "<p>texto</p>" * 15000
        + "<article><p>" + PARAGRAPH * 10 + "</p></article>"
        + "</body></html>"
    )
    text = extract_text(page(html, "utf-8", "utf-8"))
    assert "vacinação" in text


@pytest.mark.parametrize("charset", ["punycode", "idna", "undefined"])
def test_unsupported_charset_falls_back_to_sniffing(charset):
    html = "<html><body><article><p>" + PARAGRAPH * 10 + "</p></article></body></html>"
    started = time.monotonic()
    text = extract_text_from_url("https://news.example/a", fetch=lambda url: page(html, "utf-8", charset))
    elapsed = time.monotonic() - started
    assert "vacinação" in text
    assert elapsed < 2.0


@pytest.mark.parametrize("charset", ["punycode", "idna", "undefined", "rot13"])
def test_unsupported_charset_markup_is_untouched_bytes(charset):
    content = b"<html><body><article><p>plain ascii text only</p></article></body></html>"
    fetched = FetchedPage(url="https://news.example/a", content=content, charset=charset)
    assert _markup(fetched) is content


def test_latin1_charset_is_normalized_and_decoded():
    html = "<html><body><article><p>" + PARAGRAPH * 10 + "</p></article></body></html>"
    text = extract_text_from_url("https://news.example/a", fetch=lambda url: page(html, "latin-1", "latin1"))
    assert "vacinação" in text


def test_url_token_does_not_leak_into_warning_logs(caplog):
    caplog.set_level(logging.WARNING)
    fetched = FetchedPage(url="https://docs.example/d/SECRET-TOKEN-123?x=1", content=b"", charset=None)
    with pytest.raises(InputError):
        extract_text(fetched)
    assert "SECRET-TOKEN-123" not in caplog.text
