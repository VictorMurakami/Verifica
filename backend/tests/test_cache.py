import sqlite3

from app.services.cache import ResultCache, cache_key, canonical_url
from app.services.db import Database


class Clock:
    def __init__(self, now: float) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def make_cache(tmp_path, clock, ttl=100, max_entries=2000):
    return ResultCache(Database(tmp_path / "cache.db"), ttl_seconds=ttl, max_entries=max_entries, now=clock)


def test_roundtrip(tmp_path):
    cache = make_cache(tmp_path, Clock(1000.0))
    cache.put("k", {"reliabilityScore": 80, "overallVerdict": "Confiável: ação"})
    assert cache.get("k") == {"reliabilityScore": 80, "overallVerdict": "Confiável: ação"}
    assert cache.get("outra") is None


def test_entry_expires_after_ttl(tmp_path):
    clock = Clock(1000.0)
    cache = make_cache(tmp_path, clock, ttl=100)
    cache.put("k", {"a": 1})
    clock.now = 1099.0
    assert cache.get("k") == {"a": 1}
    clock.now = 1100.0
    assert cache.get("k") is None


def test_max_entries_keeps_newest(tmp_path):
    clock = Clock(1000.0)
    cache = make_cache(tmp_path, clock, ttl=10_000, max_entries=3)
    for i in range(5):
        clock.now = 1000.0 + i
        cache.put(f"k{i}", {"i": i})
    assert cache.get("k0") is None
    assert cache.get("k1") is None
    assert cache.get("k4") == {"i": 4}


def test_put_overwrites_same_key(tmp_path):
    cache = make_cache(tmp_path, Clock(1000.0))
    cache.put("k", {"v": 1})
    cache.put("k", {"v": 2})
    assert cache.get("k") == {"v": 2}


def test_purge_deletes_expired_without_a_put(tmp_path):
    clock = Clock(1000.0)
    cache = make_cache(tmp_path, clock, ttl=100)
    cache.put("k1", {"a": 1})
    clock.now = 1101.0
    cache.purge()
    with sqlite3.connect(tmp_path / "cache.db") as conn:
        keys = {row[0] for row in conn.execute("SELECT key FROM cache")}
    assert keys == set()


def test_purge_keeps_entries_within_ttl(tmp_path):
    clock = Clock(1000.0)
    cache = make_cache(tmp_path, clock, ttl=100)
    cache.put("k1", {"a": 1})
    clock.now = 1050.0
    cache.purge()
    assert cache.get("k1") == {"a": 1}


def test_canonical_url_drops_tracking_and_fragment():
    assert canonical_url("HTTPS://News.Example/Materia?utm_source=x&id=1&fbclid=y#topo") == "https://news.example/Materia?id=1"
    assert canonical_url("https://news.example") == "https://news.example/"


def test_cache_key_normalizes_url_and_text():
    assert cache_key("https://news.example/a?utm_medium=z", is_url=True) == cache_key("https://news.example/a", is_url=True)
    assert cache_key("uma   notícia\n qualquer", is_url=False) == cache_key("uma notícia qualquer", is_url=False)
    assert cache_key("https://news.example/a", is_url=True) != cache_key("https://news.example/a", is_url=False)
