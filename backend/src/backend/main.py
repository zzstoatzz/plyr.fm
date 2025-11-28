"""relay fastapi application."""

import logging
import warnings
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

# filter pydantic warning from atproto library
warnings.filterwarnings(
    "ignore",
    message="The 'default' attribute with value None was provided to the `Field\\(\\)` function",
    category=UserWarning,
    module="pydantic._internal._generate_schema",
)

from backend._internal import notification_service, queue_service
from backend.api import (
    account_router,
    artists_router,
    audio_router,
    auth_router,
    exports_router,
    oembed_router,
    preferences_router,
    queue_router,
    search_router,
    tracks_router,
)
from backend.api.albums import router as albums_router
from backend.api.migration import router as migration_router
from backend.config import settings
from backend.models import init_db
from backend.utilities.rate_limit import limiter

# configure logfire if enabled
if settings.observability.enabled:
    import logfire

    if not settings.observability.write_token:
        raise ValueError("LOGFIRE_WRITE_TOKEN must be set when LOGFIRE_ENABLED is true")

    logfire.configure(
        token=settings.observability.write_token,
        environment=settings.observability.environment,
    )

    # configure logging with logfire handler
    logging.basicConfig(
        level=logging.DEBUG if settings.app.debug else logging.INFO,
        handlers=[logfire.LogfireLoggingHandler()],
    )
else:
    logfire = None
    # fallback to basic logging when logfire is disabled
    logging.basicConfig(
        level=logging.DEBUG if settings.app.debug else logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

# # reduce noise from verbose loggers
# logging.getLogger("httpx").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)


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


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """handle application lifespan events."""
    # startup: initialize database
    # NOTE: init_db() is still needed because base tables (artists, tracks, user_sessions)
    # don't have migrations - they were created before migrations were introduced.
    # See issue #46 for removing this in favor of a proper initial migration.
    await init_db()

    # setup services
    await notification_service.setup()
    await queue_service.setup()

    yield

    # shutdown: cleanup resources
    await notification_service.shutdown()
    await queue_service.shutdown()


app = FastAPI(
    title=settings.app.name,
    debug=settings.app.debug,
    lifespan=lifespan,
    default_response_class=ORJSONResponse,
)

# setup rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# instrument fastapi with logfire
if logfire:
    logfire.instrument_fastapi(app)

# add security headers middleware
app.add_middleware(SecurityHeadersMiddleware)

# configure CORS - allow localhost for dev and cloudflare pages for production
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=settings.frontend.resolved_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# add rate limiting middleware
app.add_middleware(SlowAPIMiddleware)

# include routers
app.include_router(auth_router)
app.include_router(account_router)
app.include_router(artists_router)
app.include_router(tracks_router)
app.include_router(albums_router)
app.include_router(audio_router)
app.include_router(search_router)
app.include_router(preferences_router)
app.include_router(queue_router)
app.include_router(migration_router)
app.include_router(exports_router)
app.include_router(oembed_router)


@app.get("/health")
async def health() -> dict[str, str]:
    """health check endpoint."""
    return {"status": "ok"}


@app.get("/config")
async def get_public_config() -> dict[str, int]:
    """expose public configuration to frontend."""
    return {
        "max_upload_size_mb": settings.storage.max_upload_size_mb,
        "max_image_size_mb": 20,  # hardcoded limit for cover art
    }


@app.get("/oauth-client-metadata.json")
async def client_metadata() -> dict:
    """serve OAuth client metadata."""
    # Extract base URL from client_id for client_uri
    client_uri = settings.atproto.client_id.replace("/oauth-client-metadata.json", "")

    return {
        "client_id": settings.atproto.client_id,
        "client_name": settings.app.name,
        "client_uri": client_uri,
        "redirect_uris": [settings.atproto.redirect_uri],
        "scope": settings.atproto.resolved_scope,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "web",
        "dpop_bound_access_tokens": True,
    }
