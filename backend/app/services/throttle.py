from __future__ import annotations

import threading
import time
from collections import deque
from contextlib import contextmanager
from typing import Callable, Iterator

from app.core import messages
from app.core.errors import BusyError

WINDOW_SECONDS = 60.0
SLOT_RETRY_AFTER = 30
WINDOW_RETRY_AFTER = 60


class Throttle:
    def __init__(
        self,
        *,
        max_concurrency: int,
        per_minute: int,
        wait_seconds: float = 20.0,
        max_fetches: int = 4,
        fetch_wait_seconds: float = 10.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._slots = threading.BoundedSemaphore(max_concurrency)
        self._fetch_slots = threading.BoundedSemaphore(max_fetches)
        self._per_minute = per_minute
        self._wait_seconds = wait_seconds
        self._fetch_wait_seconds = fetch_wait_seconds
        self._clock = clock
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()

    @contextmanager
    def concurrency_slot(self) -> Iterator[None]:
        if not self._slots.acquire(timeout=self._wait_seconds):
            raise BusyError(messages.BUSY, retry_after=SLOT_RETRY_AFTER)
        try:
            yield
        finally:
            self._slots.release()

    @contextmanager
    def fetch_slot(self) -> Iterator[None]:
        if not self._fetch_slots.acquire(timeout=self._fetch_wait_seconds):
            raise BusyError(messages.BUSY, retry_after=SLOT_RETRY_AFTER)
        try:
            yield
        finally:
            self._fetch_slots.release()

    def take_minute_token(self) -> None:
        now = self._clock()
        with self._lock:
            while self._calls and now - self._calls[0] >= WINDOW_SECONDS:
                self._calls.popleft()
            if len(self._calls) >= self._per_minute:
                raise BusyError(messages.BUSY, retry_after=WINDOW_RETRY_AFTER)
            self._calls.append(now)
