"""relay fastapi application."""

import asyncio
import contextlib
import logging
import warnings
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# filter pydantic warning from atproto library
warnings.filterwarnings(
    "ignore",
    message="The 'default' attribute with value None was provided to the `Field\\(\\)` function",
    category=UserWarning,
    module="pydantic._internal._generate_schema",
)

from backend._internal import notification_service, queue_service
from backend.api import (
    artists_router,
    audio_router,
    auth_router,
    preferences_router,
    queue_router,
    search_router,
    tracks_router,
)
from backend.api.migration import router as migration_router
from backend.config import settings
from backend.models import init_db

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


async def run_periodic_tasks():
    """run periodic background tasks."""
    while True:
        try:
            # check for new tracks and send notifications
            await notification_service.check_new_tracks()

            # NOTE: OAuth state cleanup is handled lazily in PostgresStateStore
            # (cleanup happens automatically on save_state/get_state during OAuth flows)
        except Exception:
            logger.exception("error in periodic task")
        await asyncio.sleep(settings.app.background_task_interval_seconds)


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

    # start background task for periodic work
    task = asyncio.create_task(run_periodic_tasks())

    yield

    # shutdown: cleanup resources
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    await notification_service.shutdown()
    await queue_service.shutdown()


app = FastAPI(
    title=settings.app.name,
    debug=settings.app.debug,
    lifespan=lifespan,
)

# instrument fastapi with logfire
if logfire:
    logfire.instrument_fastapi(app)

# configure CORS - allow localhost for dev and cloudflare pages for production
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=settings.frontend.resolved_cors_origin_regex,
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
app.include_router(migration_router)


@app.get("/health")
async def health() -> dict[str, str]:
    """health check endpoint."""
    return {"status": "ok"}


@app.get("/client-metadata.json")
async def client_metadata() -> dict:
    """serve OAuth client metadata."""
    # Extract base URL from client_id for client_uri
    client_uri = settings.atproto.client_id.replace("/client-metadata.json", "")

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
