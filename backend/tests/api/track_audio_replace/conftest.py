"""pytest fixtures shared across the audio-replace test suite.

scoped to this directory only — no side effects on other tests.
"""

from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Artist

from ._helpers import OTHER_DID, OWNER_DID, MockSession


@pytest.fixture
async def owner(db_session: AsyncSession) -> Artist:
    artist = Artist(did=OWNER_DID, handle="owner.bsky.social", display_name="Owner")
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
async def other_artist(db_session: AsyncSession) -> Artist:
    artist = Artist(did=OTHER_DID, handle="other.bsky.social", display_name="Other")
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
def test_app_owner() -> Generator[FastAPI, None, None]:
    """app with require_auth overridden to return the OWNER session."""

    async def _auth() -> Session:
        return MockSession(OWNER_DID)

    app.dependency_overrides[require_auth] = _auth
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def test_app_other() -> Generator[FastAPI, None, None]:
    """app with require_auth overridden to return a non-owner session."""

    async def _auth() -> Session:
        return MockSession(OTHER_DID)

    app.dependency_overrides[require_auth] = _auth
    yield app
    app.dependency_overrides.clear()
