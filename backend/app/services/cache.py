from __future__ import annotations

import hashlib
import json
import time
from contextlib import closing
from typing import Callable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.services.db import Database

TRACKING_PARAMS = frozenset({"fbclid", "gclid"})
DEFAULT_MAX_ENTRIES = 2000


def _is_tracking(name: str) -> bool:
    lowered = name.lower()
    return lowered.startswith("utm_") or lowered in TRACKING_PARAMS


def canonical_url(url: str) -> str:
    parts = urlsplit(url.strip())
    query = urlencode(
        [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if not _is_tracking(key)]
    )
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path or "/", query, ""))


def cache_key(content: str, *, is_url: bool) -> str:
    material = f"u:{canonical_url(content)}" if is_url else "t:" + " ".join(content.split())
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


class ResultCache:
    def __init__(
        self,
        db: Database,
        *,
        ttl_seconds: int,
        max_entries: int = DEFAULT_MAX_ENTRIES,
        now: Callable[[], float] = time.time,
    ) -> None:
        self._db = db
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._now = now

    def get(self, key: str) -> dict | None:
        cutoff = int(self._now()) - self._ttl_seconds
        with closing(self._db.connect()) as conn:
            row = conn.execute(
                "SELECT payload FROM cache WHERE key = ? AND created_at > ?", (key, cutoff)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, key: str, payload: dict) -> None:
        now = int(self._now())
        with closing(self._db.connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                conn.execute(
                    "INSERT INTO cache (key, payload, created_at) VALUES (?, ?, ?) "
                    "ON CONFLICT (key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at",
                    (key, json.dumps(payload, ensure_ascii=False), now),
                )
                conn.execute("DELETE FROM cache WHERE created_at <= ?", (now - self._ttl_seconds,))
                conn.execute(
                    "DELETE FROM cache WHERE key NOT IN "
                    "(SELECT key FROM cache ORDER BY created_at DESC, rowid DESC LIMIT ?)",
                    (self._max_entries,),
                )
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise

    def purge(self) -> None:
        cutoff = int(self._now()) - self._ttl_seconds
        with closing(self._db.connect()) as conn:
            conn.execute("DELETE FROM cache WHERE created_at <= ?", (cutoff,))
