from __future__ import annotations

import math
import sqlite3
from contextlib import closing
from datetime import datetime, time, timedelta
from typing import Callable
from zoneinfo import ZoneInfo

from app.core import messages
from app.core.errors import BusyError, QuotaExceeded
from app.services.db import Database

SAO_PAULO = ZoneInfo("America/Sao_Paulo")
GLOBAL_SCOPE = "global"


def sao_paulo_now() -> datetime:
    return datetime.now(SAO_PAULO)


class QuotaStore:
    def __init__(
        self,
        db: Database,
        *,
        per_ip_daily: int,
        global_daily: int,
        now: Callable[[], datetime] = sao_paulo_now,
    ) -> None:
        self._db = db
        self._per_ip_daily = per_ip_daily
        self._global_daily = global_daily
        self._now = now

    def reserve(self, fingerprint: str) -> None:
        now = self._now()
        day = now.date().isoformat()
        oldest_kept = (now.date() - timedelta(days=1)).isoformat()
        ip_scope = _ip_scope(fingerprint)
        with closing(self._db.connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                conn.execute("DELETE FROM usage WHERE day < ?", (oldest_kept,))
                if _count(conn, day, ip_scope) >= self._per_ip_daily:
                    raise QuotaExceeded(messages.IP_QUOTA, retry_after=_seconds_until_midnight(now))
                if _count(conn, day, GLOBAL_SCOPE) >= self._global_daily:
                    raise BusyError(messages.GLOBAL_QUOTA, retry_after=_seconds_until_midnight(now))
                for scope in (ip_scope, GLOBAL_SCOPE):
                    conn.execute(
                        "INSERT INTO usage (day, scope, count) VALUES (?, ?, 1) "
                        "ON CONFLICT (day, scope) DO UPDATE SET count = count + 1",
                        (day, scope),
                    )
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise

    def ensure_available(self, fingerprint: str) -> None:
        now = self._now()
        day = now.date().isoformat()
        ip_scope = _ip_scope(fingerprint)
        with closing(self._db.connect()) as conn:
            if _count(conn, day, ip_scope) >= self._per_ip_daily:
                raise QuotaExceeded(messages.IP_QUOTA, retry_after=_seconds_until_midnight(now))
            if _count(conn, day, GLOBAL_SCOPE) >= self._global_daily:
                raise BusyError(messages.GLOBAL_QUOTA, retry_after=_seconds_until_midnight(now))

    def release(self, fingerprint: str) -> None:
        day = self._now().date().isoformat()
        with closing(self._db.connect()) as conn:
            conn.execute(
                "UPDATE usage SET count = MAX(count - 1, 0) WHERE day = ? AND scope IN (?, ?)",
                (day, _ip_scope(fingerprint), GLOBAL_SCOPE),
            )

    def usage(self, fingerprint: str) -> tuple[int, int]:
        day = self._now().date().isoformat()
        with closing(self._db.connect()) as conn:
            return _count(conn, day, _ip_scope(fingerprint)), _count(conn, day, GLOBAL_SCOPE)

    def seconds_until_reset(self) -> int:
        return _seconds_until_midnight(self._now())

    def purge(self) -> None:
        day = self._now().date().isoformat()
        with closing(self._db.connect()) as conn:
            conn.execute("DELETE FROM usage WHERE day < ?", (day,))


def _ip_scope(fingerprint: str) -> str:
    return f"ip:{fingerprint}"


def _count(conn: sqlite3.Connection, day: str, scope: str) -> int:
    row = conn.execute("SELECT count FROM usage WHERE day = ? AND scope = ?", (day, scope)).fetchone()
    return row[0] if row else 0


def _seconds_until_midnight(now: datetime) -> int:
    tomorrow = datetime.combine(now.date() + timedelta(days=1), time.min, tzinfo=now.tzinfo)
    return max(1, math.ceil((tomorrow - now).total_seconds()))
