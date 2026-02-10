"""HTTP middleware."""

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from backend.config import settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """middleware to add security headers to all responses."""

    async def dispatch(self, request: Request, call_next):
        """dispatch the request."""
        response = await call_next(request)

        # prevent MIME sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"

        # enable browser XSS protection
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # control referrer information
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # enforce HTTPS in production (HSTS)
        # skip in debug mode (localhost usually doesn't have https)
        if not settings.app.debug:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )

        return response
