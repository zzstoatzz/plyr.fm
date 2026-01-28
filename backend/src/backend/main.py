"""relay fastapi application."""

import asyncio
import logging
import re
import warnings
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse, PlainTextResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware

# filter pydantic warning from atproto library
warnings.filterwarnings(
    "ignore",
    message="The 'default' attribute with value None was provided to the `Field\\(\\)` function",
    category=UserWarning,
    module="pydantic._internal._generate_schema",
)

from backend._internal import notification_service, queue_service
from backend._internal.auth import get_public_jwks, is_confidential_client
from backend._internal.background import background_worker_lifespan
from backend.api import (
    account_router,
    artists_router,
    audio_router,
    auth_router,
    exports_router,
    moderation_router,
    now_playing_router,
    oembed_router,
    preferences_router,
    queue_router,
    search_router,
    stats_router,
    tracks_router,
    users_router,
)
from backend.api.albums import router as albums_router
from backend.api.lists import router as lists_router
from backend.api.migration import router as migration_router
from backend.config import settings
from backend.models import Album, Artist, Track, get_db
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

# reduce noise from verbose loggers
for logger_name in settings.observability.suppressed_loggers:
    logging.getLogger(logger_name).setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

# pattern to match plyrfm SDK/MCP user-agent headers
# format: "plyrfm/{version}" or "plyrfm-mcp/{version}"
_PLYRFM_UA_PATTERN = re.compile(r"^plyrfm(-mcp)?/(\d+\.\d+\.\d+)")


def parse_plyrfm_user_agent(user_agent: str | None) -> dict[str, str]:
    """parse plyrfm SDK/MCP user-agent into span attributes.

    returns dict with:
        - client_type: "sdk", "mcp", or "browser"
        - client_version: version string (only for sdk/mcp)
    """
    if not user_agent:
        return {"client_type": "browser"}

    match = _PLYRFM_UA_PATTERN.match(user_agent)
    if not match:
        return {"client_type": "browser"}

    is_mcp = match.group(1) is not None  # "-mcp" suffix present
    version = match.group(2)

    return {
        "client_type": "mcp" if is_mcp else "sdk",
        "client_version": version,
    }


def request_attributes_mapper(
    request: Request | WebSocket, attributes: dict[str, Any], /
) -> dict[str, Any] | None:
    """extract client metadata from request headers for span enrichment."""
    user_agent = request.headers.get("user-agent")
    return parse_plyrfm_user_agent(user_agent)


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
    # setup services
    await notification_service.setup()
    await queue_service.setup()

    # start background task worker (docket)
    async with background_worker_lifespan() as docket:
        # store docket on app state for access in routes if needed
        app.state.docket = docket
        yield

    # shutdown: cleanup resources with timeouts to avoid hanging
    try:
        await asyncio.wait_for(notification_service.shutdown(), timeout=2.0)
    except TimeoutError:
        logging.warning("notification_service.shutdown() timed out")
    try:
        await asyncio.wait_for(queue_service.shutdown(), timeout=2.0)
    except TimeoutError:
        logging.warning("queue_service.shutdown() timed out")


app = FastAPI(
    title=settings.app.name,
    debug=settings.app.debug,
    lifespan=lifespan,
    default_response_class=ORJSONResponse,
)

# setup rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

# instrument fastapi with logfire
if logfire:
    logfire.instrument_fastapi(app, request_attributes_mapper=request_attributes_mapper)

# add security headers middleware
app.add_middleware(SecurityHeadersMiddleware)  # type: ignore[arg-type]

# configure CORS - allow localhost for dev and cloudflare pages for production
app.add_middleware(
    CORSMiddleware,  # type: ignore[arg-type]
    allow_origin_regex=settings.frontend.resolved_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# add rate limiting middleware
app.add_middleware(SlowAPIMiddleware)  # type: ignore[arg-type]

# include routers
app.include_router(auth_router)
app.include_router(account_router)
app.include_router(artists_router)
app.include_router(tracks_router)
app.include_router(albums_router)
app.include_router(lists_router)
app.include_router(audio_router)
app.include_router(search_router)
app.include_router(preferences_router)
app.include_router(queue_router)
app.include_router(now_playing_router)
app.include_router(migration_router)
app.include_router(exports_router)
app.include_router(moderation_router)
app.include_router(oembed_router)
app.include_router(stats_router)
app.include_router(users_router)


@app.get("/health")
async def health() -> dict[str, str]:
    """health check endpoint."""
    return {"status": "ok"}


@app.get("/config")
async def get_public_config() -> dict[str, int | str | list[str]]:
    """expose public configuration to frontend."""
    from backend.utilities.tags import DEFAULT_HIDDEN_TAGS

    return {
        "max_upload_size_mb": settings.storage.max_upload_size_mb,
        "max_image_size_mb": 20,  # hardcoded limit for cover art
        "default_hidden_tags": DEFAULT_HIDDEN_TAGS,
        "bufo_exclude_patterns": list(settings.bufo.exclude_patterns),
        "bufo_include_patterns": list(settings.bufo.include_patterns),
        "contact_email": settings.legal.contact_email,
        "privacy_email": settings.legal.resolved_privacy_email,
        "dmca_email": settings.legal.resolved_dmca_email,
        "dmca_registration_number": settings.legal.dmca_registration_number,
    }


@app.get("/oauth-client-metadata.json")
async def client_metadata() -> dict[str, Any]:
    """serve OAuth client metadata.

    returns metadata for public or confidential client depending on
    whether OAUTH_JWK is configured.
    """
    # extract base URL from client_id for client_uri
    client_uri = settings.atproto.client_id.replace("/oauth-client-metadata.json", "")

    metadata: dict[str, Any] = {
        "client_id": settings.atproto.client_id,
        "client_name": settings.app.name,
        "client_uri": client_uri,
        "redirect_uris": [settings.atproto.redirect_uri],
        "scope": settings.atproto.resolved_scope_with_teal(
            settings.teal.play_collection, settings.teal.status_collection
        ),
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "application_type": "web",
        "dpop_bound_access_tokens": True,
    }

    if is_confidential_client():
        # confidential client: use private_key_jwt authentication
        # this gives us 180-day refresh tokens instead of 2-week
        metadata["token_endpoint_auth_method"] = "private_key_jwt"
        metadata["token_endpoint_auth_signing_alg"] = "ES256"
        metadata["jwks_uri"] = f"{client_uri}/.well-known/jwks.json"
    else:
        # public client: no authentication
        metadata["token_endpoint_auth_method"] = "none"

    return metadata


@app.get("/.well-known/jwks.json")
async def jwks_endpoint() -> dict[str, Any]:
    """serve public JWKS for confidential client authentication.

    returns 404 if confidential client is not configured.
    """
    jwks = get_public_jwks()
    if jwks is None:
        raise HTTPException(
            status_code=404,
            detail="JWKS not available - confidential client not configured",
        )

    return jwks


@app.get("/robots.txt", include_in_schema=False)
async def robots_txt():
    """serve robots.txt to tell crawlers this is an API, not a website."""
    return PlainTextResponse(
        "User-agent: *\nDisallow: /\n",
        media_type="text/plain",
    )


@app.get("/sitemap-data")
async def sitemap_data(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """return minimal data needed to generate sitemap.xml.

    returns tracks, artists, and albums with just IDs/slugs and timestamps.
    the frontend renders this into XML at /sitemap.xml.
    """
    # fetch all tracks (id, created_at)
    tracks_result = await db.execute(
        select(Track.id, Track.created_at).order_by(Track.created_at.desc())
    )
    tracks = [
        {"id": row.id, "updated": row.created_at.strftime("%Y-%m-%d")}
        for row in tracks_result.all()
    ]

    # fetch all artists with at least one track (handle, updated_at)
    artists_result = await db.execute(
        select(Artist.handle, Artist.updated_at)
        .join(Track, Artist.did == Track.artist_did)
        .distinct()
        .order_by(Artist.updated_at.desc())
    )
    artists = [
        {"handle": row.handle, "updated": row.updated_at.strftime("%Y-%m-%d")}
        for row in artists_result.all()
    ]

    # fetch all albums (artist handle, slug, updated_at)
    albums_result = await db.execute(
        select(Album.slug, Artist.handle, Album.updated_at)
        .join(Artist, Album.artist_did == Artist.did)
        .order_by(Album.updated_at.desc())
    )
    albums = [
        {
            "handle": row.handle,
            "slug": row.slug,
            "updated": row.updated_at.strftime("%Y-%m-%d"),
        }
        for row in albums_result.all()
    ]

    return {"tracks": tracks, "artists": artists, "albums": albums}
