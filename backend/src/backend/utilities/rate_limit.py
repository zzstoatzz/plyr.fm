"""Rate limiting utility."""

from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.config import settings

limiter = Limiter(
    key_func=get_remote_address,
    enabled=settings.rate_limit.enabled,
    default_limits=[settings.rate_limit.default_limit],
    storage_uri="memory://",
)
