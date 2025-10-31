"""relay fastapi application."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from relay.api import audio_router, auth_router, tracks_router
from relay.config import settings
from relay.models import init_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """handle application lifespan events."""
    # startup: initialize database
    init_db()
    yield
    # shutdown: cleanup resources


app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    lifespan=lifespan,
)

# configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://relay-4i6.pages.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# include routers
app.include_router(auth_router)
app.include_router(tracks_router)
app.include_router(audio_router)


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
        "scope": "atproto repo:app.relay.track",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "web",
        "dpop_bound_access_tokens": True,
    }
