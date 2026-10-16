import pytest

from app.core.errors import BusyError
from app.services.throttle import Throttle


class Clock:
    def __init__(self, value: float) -> None:
        self.value = value

    def __call__(self) -> float:
        return self.value


def test_concurrency_slot_times_out_when_full():
    throttle = Throttle(max_concurrency=1, per_minute=10, wait_seconds=0.05)
    with throttle.concurrency_slot():
        with pytest.raises(BusyError) as exc:
            with throttle.concurrency_slot():
                pass
        assert exc.value.retry_after == 30
    with throttle.concurrency_slot():
        pass


def test_slot_is_released_on_error():
    throttle = Throttle(max_concurrency=1, per_minute=10, wait_seconds=0.05)
    with pytest.raises(RuntimeError):
        with throttle.concurrency_slot():
            raise RuntimeError("falha")
    with throttle.concurrency_slot():
        pass


def test_fetch_slot_times_out_when_full():
    throttle = Throttle(max_concurrency=1, per_minute=10, max_fetches=1, fetch_wait_seconds=0.05)
    with throttle.fetch_slot():
        with pytest.raises(BusyError) as exc:
            with throttle.fetch_slot():
                pass
        assert exc.value.retry_after == 30
    with throttle.fetch_slot():
        pass


def test_fetch_slot_is_released_on_error():
    throttle = Throttle(max_concurrency=1, per_minute=10, max_fetches=1, fetch_wait_seconds=0.05)
    with pytest.raises(RuntimeError):
        with throttle.fetch_slot():
            raise RuntimeError("falha")
    with throttle.fetch_slot():
        pass


def test_minute_window():
    clock = Clock(100.0)
    throttle = Throttle(max_concurrency=2, per_minute=2, clock=clock)
    throttle.take_minute_token()
    throttle.take_minute_token()
    with pytest.raises(BusyError) as exc:
        throttle.take_minute_token()
    assert exc.value.retry_after == 60
    clock.value = 159.9
    with pytest.raises(BusyError):
        throttle.take_minute_token()
    clock.value = 160.0
    throttle.take_minute_token()
