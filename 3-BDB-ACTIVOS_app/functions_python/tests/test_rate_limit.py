import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rate_limit import RateLimitExceeded, UserRateLimiter


def test_user_rate_limiter_is_scoped_by_user_and_operation():
    limiter = UserRateLimiter()
    limiter.check("user-a", "optimize", limit=2, now=10)
    limiter.check("user-a", "optimize", limit=2, now=11)
    limiter.check("user-b", "optimize", limit=2, now=11)
    limiter.check("user-a", "report", limit=2, now=11)

    with pytest.raises(RateLimitExceeded) as exc:
        limiter.check("user-a", "optimize", limit=2, now=12)
    assert exc.value.retry_after_seconds == 58


def test_user_rate_limiter_releases_events_after_window():
    limiter = UserRateLimiter()
    limiter.check("user-a", "optimize", limit=1, window_seconds=60, now=10)
    limiter.check("user-a", "optimize", limit=1, window_seconds=60, now=70)


def test_user_rate_limiter_bounds_stored_keys():
    limiter = UserRateLimiter(max_keys=2)
    limiter.check("a", "op", limit=1, now=1)
    limiter.check("b", "op", limit=1, now=2)
    limiter.check("c", "op", limit=1, now=3)
    assert len(limiter._events) == 2
