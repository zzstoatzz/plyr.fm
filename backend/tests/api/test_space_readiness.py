"""Readiness reflects granted operations, not just permission to create."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.config import settings
from backend.main import app
from backend.models import Artist

DID = "did:plc:readiness"
OPERATIONS = (
    "action=read",
    "action=create",
    "action=update",
    "action=delete",
    "manage=create",
    "manage=update",
    "manage=delete",
)


def owner_scope(skey: str, omitted: str | None = None) -> str:
    operations = "&".join(op for op in OPERATIONS if op != omitted)
    return (
        f"space:{settings.atproto.private_media_space_type}?authority={DID}"
        f"&skey={skey}&collection={settings.atproto.track_collection}&{operations}"
    )


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    artist = Artist(did=DID, handle="readiness.test", display_name="readiness")
    db_session.add(artist)
    await db_session.commit()
    return artist


@pytest.fixture
def readiness_app(artist: Artist) -> Generator[tuple[FastAPI, Session], None, None]:
    session = Session(
        session_id="readiness",
        did=DID,
        handle=artist.handle,
        oauth_session={"scope": "atproto"},
    )

    async def authenticated() -> Session:
        return session

    app.dependency_overrides[require_auth] = authenticated
    try:
        yield app, session
    finally:
        app.dependency_overrides.pop(require_auth, None)


@pytest.mark.parametrize("skey", ["self", "playback"])
@pytest.mark.parametrize("omitted", [None, *OPERATIONS])
async def test_auth_me_rejects_partial_owner_grants(
    readiness_app: tuple[FastAPI, Session], skey: str, omitted: str | None
) -> None:
    application, session = readiness_app
    other_key = "playback" if skey == "self" else "self"
    session.oauth_session["scope"] = (
        f"atproto {owner_scope(skey, omitted)} {owner_scope(other_key)}"
    )
    with patch(
        "backend.api.auth.pds_supports_spaces", new=AsyncMock(return_value=True)
    ):
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            response = await client.get("/auth/me")
    assert response.status_code == 200
    assert response.json()["permissioned_spaces"] == {
        "supported": True,
        "granted": omitted is None,
        "reader": False,
    }


async def test_auth_me_accepts_split_owner_grants_without_reader(
    readiness_app: tuple[FastAPI, Session],
) -> None:
    application, session = readiness_app
    grants = []
    for skey in ("self", "playback"):
        prefix = (
            f"space:{settings.atproto.private_media_space_type}?authority={DID}"
            f"&skey={skey}&collection={settings.atproto.track_collection}"
        )
        grants.extend(f"{prefix}&{operation}" for operation in OPERATIONS)
    session.oauth_session["scope"] = "atproto " + " ".join(grants)
    with patch(
        "backend.api.auth.pds_supports_spaces", new=AsyncMock(return_value=True)
    ):
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            response = await client.get("/auth/me")
    assert response.status_code == 200
    assert response.json()["permissioned_spaces"] == {
        "supported": True,
        "granted": True,
        "reader": False,
    }
