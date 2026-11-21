from __future__ import annotations

from collections import deque
import threading
import time


class RateLimitExceeded(RuntimeError):
    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__("Rate limit exceeded")
        self.retry_after_seconds = max(1, int(retry_after_seconds))


class UserRateLimiter:
    """Best-effort per-instance limiter, bounded by the function max_instances cap."""

    def __init__(self, max_keys: int = 2000) -> None:
        self.max_keys = max(1, max_keys)
        self._events: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def check(
        self,
        uid: str,
        operation: str,
        *,
        limit: int,
        window_seconds: int = 60,
        now: float | None = None,
    ) -> None:
        if limit <= 0 or window_seconds <= 0:
            raise ValueError("limit and window_seconds must be positive")
        timestamp = time.monotonic() if now is None else float(now)
        threshold = timestamp - window_seconds
        key = (uid, operation)

        with self._lock:
            events = self._events.setdefault(key, deque())
            while events and events[0] <= threshold:
                events.popleft()
            if len(events) >= limit:
                retry_after = window_seconds - (timestamp - events[0])
                raise RateLimitExceeded(max(1, round(retry_after)))
            events.append(timestamp)
            if len(self._events) > self.max_keys:
                self._drop_oldest_key(except_key=key)

    def _drop_oldest_key(self, except_key: tuple[str, str]) -> None:
        candidates = (
            (events[-1] if events else float("-inf"), key)
            for key, events in self._events.items()
            if key != except_key
        )
        _, oldest_key = min(candidates, default=(0.0, except_key))
        if oldest_key != except_key:
            self._events.pop(oldest_key, None)
