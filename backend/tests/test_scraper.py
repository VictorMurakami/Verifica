import pytest

from app.core import messages
from app.core.errors import InputError
from app.services.safe_fetch import FetchedPage
from app.services.scraper import extract_text_from_url

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
