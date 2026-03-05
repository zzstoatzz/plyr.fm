"""plyr.fm backend application."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from backend._internal import jam_service, notification_service, queue_service
from backend._internal.background import background_worker_lifespan
from backend.api import (
    account_router,
    activity_router,
    artists_router,
    audio_router,
    auth_router,
    discover_router,
    exports_router,
    jams_router,
    meta_router,
    moderation_router,
    now_playing_router,
    oembed_router,
    pds_backfill_router,
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
from backend.utilities.middleware import SecurityHeadersMiddleware
from backend.utilities.observability import (
    configure_observability,
    request_attributes_mapper,
    suppress_warnings,
)
from backend.utilities.rate_limit import limiter

# suppress pydantic warnings before atproto imports
suppress_warnings()

# configure logfire + logging
logfire = configure_observability(settings)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """handle application lifespan events."""
    # setup services
    await notification_service.setup()
    await queue_service.setup()
    await jam_service.setup()

    # warm the database connection pool so the first request avoids cold connect
    try:
        from sqlalchemy import text

        from backend.utilities.database import get_engine

        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("database connection pool warmed")
    except Exception:
        logger.warning("failed to warm database connection pool")

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
    try:
        await asyncio.wait_for(jam_service.shutdown(), timeout=2.0)
    except TimeoutError:
        logging.warning("jam_service.shutdown() timed out")


app = FastAPI(
    title=settings.app.name,
    debug=settings.app.debug,
    lifespan=lifespan,
    default_response_class=ORJSONResponse,
)

# setup rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]


async def _unhandled_exception_handler(request: Request, exc: Exception) -> Response:
    """log unhandled exceptions so they appear in logfire with full tracebacks."""
    logger.exception("unhandled exception on %s %s", request.method, request.url.path)
    return ORJSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error"},
    )


app.add_exception_handler(Exception, _unhandled_exception_handler)

# instrument fastapi with logfire
if logfire:
    logfire.instrument_fastapi(app, request_attributes_mapper=request_attributes_mapper)

# middleware
app.add_middleware(SecurityHeadersMiddleware)  # type: ignore[arg-type]
app.add_middleware(
    CORSMiddleware,  # type: ignore[arg-type]
    allow_origin_regex=settings.frontend.resolved_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SlowAPIMiddleware)  # type: ignore[arg-type]

# routers
app.include_router(auth_router)
app.include_router(account_router)
app.include_router(activity_router)
app.include_router(artists_router)
app.include_router(discover_router)
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
app.include_router(jams_router)
app.include_router(pds_backfill_router)
app.include_router(moderation_router)
app.include_router(oembed_router)
app.include_router(stats_router)
app.include_router(users_router)
app.include_router(meta_router)
