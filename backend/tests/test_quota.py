import inspect
import sqlite3
import threading
from datetime import datetime

import pytest

from app.core.errors import BusyError, QuotaExceeded
from app.services.db import Database
from app.services.quota import SAO_PAULO, QuotaStore, sao_paulo_now


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def at(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute, tzinfo=SAO_PAULO)


def make_store(tmp_path, clock, per_ip=10, global_daily=200):
    return QuotaStore(Database(tmp_path / "quota.db"), per_ip_daily=per_ip, global_daily=global_daily, now=clock)


def test_ip_limit_is_enforced_per_fingerprint(tmp_path):
    store = make_store(tmp_path, Clock(at(15, 12)))
    for _ in range(10):
        store.reserve("ip-a")
    with pytest.raises(QuotaExceeded) as exc:
        store.reserve("ip-a")
    assert exc.value.status_code == 429
    assert exc.value.retry_after == 12 * 3600
    store.reserve("ip-b")


def test_global_limit_is_enforced(tmp_path):
    store = make_store(tmp_path, Clock(at(15, 18)), per_ip=1000, global_daily=200)
    for i in range(200):
        store.reserve(f"ip-{i}")
    with pytest.raises(BusyError) as exc:
        store.reserve("ip-new")
    assert exc.value.status_code == 503
    assert exc.value.retry_after == 6 * 3600


def test_rejected_reservation_does_not_count(tmp_path):
    store = make_store(tmp_path, Clock(at(15, 12)), per_ip=1, global_daily=2)
    store.reserve("ip-a")
    with pytest.raises(QuotaExceeded):
        store.reserve("ip-a")
    store.reserve("ip-b")
    with pytest.raises(BusyError):
        store.reserve("ip-c")
    assert store.usage("ip-a") == (1, 2)


def test_day_rollover_in_sao_paulo_resets(tmp_path):
    clock = Clock(at(15, 23, 59))
    store = make_store(tmp_path, clock, per_ip=1)
    store.reserve("ip-a")
    with pytest.raises(QuotaExceeded) as exc:
        store.reserve("ip-a")
    assert exc.value.retry_after == 60
    clock.now = at(16, 0, 0)
    store.reserve("ip-a")


def test_release_refunds_both_counters(tmp_path):
    store = make_store(tmp_path, Clock(at(15, 12)), per_ip=1)
    store.reserve("ip-a")
    store.release("ip-a")
    assert store.usage("ip-a") == (0, 0)
    store.reserve("ip-a")


def test_release_never_goes_negative(tmp_path):
    store = make_store(tmp_path, Clock(at(15, 12)))
    store.release("ip-a")
    assert store.usage("ip-a") == (0, 0)


def test_concurrent_reservations_never_exceed_global(tmp_path):
    store = make_store(tmp_path, Clock(at(15, 12)), per_ip=1000, global_daily=50)
    successes = []
    lock = threading.Lock()

    def worker(i: int) -> None:
        try:
            store.reserve(f"ip-{i}")
        except BusyError:
            return
        with lock:
            successes.append(i)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(120)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(successes) == 50


def test_old_days_are_pruned(tmp_path):
    clock = Clock(at(13, 12))
    store = make_store(tmp_path, clock)
    store.reserve("ip-a")
    clock.now = at(15, 12)
    store.reserve("ip-a")
    with sqlite3.connect(tmp_path / "quota.db") as conn:
        days = {row[0] for row in conn.execute("SELECT DISTINCT day FROM usage")}
    assert days == {"2026-10-15"}


def test_sao_paulo_now_uses_fixed_zone():
    assert SAO_PAULO.key == "America/Sao_Paulo"
    assert sao_paulo_now().tzinfo.key == "America/Sao_Paulo"


def test_quota_store_default_clock_is_sao_paulo_now():
    assert inspect.signature(QuotaStore.__init__).parameters["now"].default is sao_paulo_now


def test_ensure_available_does_not_change_counters(tmp_path):
    store = make_store(tmp_path, Clock(at(15, 12)), per_ip=1)
    store.ensure_available("ip-a")
    assert store.usage("ip-a") == (0, 0)
    store.reserve("ip-a")
    with pytest.raises(QuotaExceeded) as exc:
        store.ensure_available("ip-a")
    assert exc.value.status_code == 429
    assert exc.value.retry_after == 12 * 3600
    assert store.usage("ip-a") == (1, 1)


def test_purge_deletes_days_before_today(tmp_path):
    clock = Clock(at(15, 12))
    store = make_store(tmp_path, clock)
    store.reserve("ip-a")
    clock.now = at(16, 12)
    store.purge()
    with sqlite3.connect(tmp_path / "quota.db") as conn:
        days = {row[0] for row in conn.execute("SELECT DISTINCT day FROM usage")}
    assert days == set()


def test_purge_keeps_today(tmp_path):
    clock = Clock(at(15, 12))
    store = make_store(tmp_path, clock)
    store.reserve("ip-a")
    store.purge()
    assert store.usage("ip-a") == (1, 1)


def test_ensure_available_reports_global_busy(tmp_path):
    store = make_store(tmp_path, Clock(at(15, 12)), per_ip=1000, global_daily=1)
    store.reserve("ip-a")
    with pytest.raises(BusyError) as exc:
        store.ensure_available("ip-b")
    assert exc.value.status_code == 503
    assert store.usage("ip-b") == (0, 1)
