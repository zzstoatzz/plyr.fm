"""relay fastapi application."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from relay._internal import notification_service, queue_service
from relay._internal.auth import _state_store
from relay.api import (
    artists_router,
    audio_router,
    auth_router,
    preferences_router,
    queue_router,
    search_router,
    tracks_router,
)
from relay.config import settings
from relay.models import init_db

logger = logging.getLogger(__name__)

# configure logfire if enabled
if settings.logfire_enabled:
    import logfire

    if not settings.logfire_write_token:
        raise ValueError("LOGFIRE_WRITE_TOKEN must be set when LOGFIRE_ENABLED is true")

    logfire.configure(
        token=settings.logfire_write_token,
        environment=settings.logfire_environment,
    )
else:
    logfire = None


async def run_periodic_tasks():
    """run periodic background tasks."""
    await notification_service.setup()
    await queue_service.setup()

    while True:
        try:
            # cleanup expired OAuth states (10 minute TTL)
            if hasattr(_state_store, "cleanup_expired_states"):
                deleted = await _state_store.cleanup_expired_states()
                if deleted > 0:
                    logger.info(f"cleaned up {deleted} expired OAuth states")
        except Exception:
            logger.exception("error in periodic task")
        await asyncio.sleep(settings.background_task_interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """handle application lifespan events."""
    # startup: initialize database
    await init_db()

    # start background task
    task = asyncio.create_task(run_periodic_tasks())

    yield

    # shutdown: cleanup resources
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    await notification_service.shutdown()
    await queue_service.shutdown()


app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    lifespan=lifespan,
)

# instrument fastapi with logfire
if logfire:
    logfire.instrument_fastapi(app)

# configure CORS - allow localhost for dev and cloudflare pages for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# include routers
app.include_router(auth_router)
app.include_router(artists_router)
app.include_router(tracks_router)
app.include_router(audio_router)
app.include_router(search_router)
app.include_router(preferences_router)
app.include_router(queue_router)


@app.get("/health")
async def health() -> dict[str, str]:
    """health check endpoint."""
    return {"status": "ok"}


@app.get("/client-metadata.json")
async def client_metadata() -> dict:
    """serve OAuth client metadata."""
    # Extract base URL from client_id for client_uri
    client_uri = settings.atproto_client_id.replace("/client-metadata.json", "")

    return {
        "client_id": settings.atproto_client_id,
        "client_name": "relay",
        "client_uri": client_uri,
        "redirect_uris": [settings.atproto_redirect_uri],
        "scope": settings.resolved_atproto_scope,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "web",
        "dpop_bound_access_tokens": True,
    }
