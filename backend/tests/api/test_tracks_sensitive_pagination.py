"""regression tests for #1676: sensitive-audio filtering must not corrupt
cursor pagination on the track listing (broken has_more / next_cursor for
anonymous viewers whenever a page contained an adult-labeled track)."""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import get_optional_session
from backend.main import app
from backend.models import Artist, Track, get_db


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    artist = Artist(
        did="did:plc:artist123",
        handle="artist.bsky.social",
        display_name="Test Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


def _track(artist: Artist, n: int, *, sensitive: bool = False) -> Track:
    """build a track; higher n = newer.

    created_at must be after the test's start so the db-clear procedure
    (which deletes rows newer than the test start time) removes these rows.
    """
    return Track(
        title=f"Track {n}",
        artist_did=artist.did,
        file_id=f"file{n}",
        file_type="mp3",
        extra={"duration": 60},
        atproto_record_uri=f"at://did:plc:artist123/fm.plyr.track/t{n}",
        atproto_record_cid=f"bafy{n}",
        created_at=datetime.now(UTC) + timedelta(seconds=n),
        self_labels=["sexual"] if sensitive else None,
    )


@pytest.fixture
def anonymous_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """app with a logged-out viewer and the test db."""

    async def mock_get_optional_session() -> None:
        return None

    async def mock_get_db():
        yield db_session

    app.dependency_overrides[get_optional_session] = mock_get_optional_session
    app.dependency_overrides[get_db] = mock_get_db
    yield app
    app.dependency_overrides.clear()


async def _fetch_all_pages(
    client: AsyncClient, limit: int, max_requests: int = 10
) -> list[dict]:
    """walk the cursor to exhaustion, returning every listed track."""
    collected: list[dict] = []
    cursor: str | None = None
    for _ in range(max_requests):
        params: dict[str, str | int] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        response = await client.get("/tracks/", params=params)
        assert response.status_code == 200
        data = response.json()
        collected.extend(data["tracks"])
        if not data["has_more"]:
            assert data["next_cursor"] is None
            return collected
        assert data["next_cursor"] is not None, "has_more=true must come with a cursor"
        cursor = data["next_cursor"]
    raise AssertionError("pagination did not terminate")


async def test_filtered_track_does_not_end_pagination_early(
    anonymous_app: FastAPI,
    db_session: AsyncSession,
    artist: Artist,
):
    """a sensitive track inside a page must not flip has_more to false.

    pre-fix: fetching limit+1 rows then filtering dropped the overflow row's
    signal, so the first page containing a sensitive track reported
    has_more=false and everything older silently disappeared for logged-out
    viewers.
    """
    tracks = [
        _track(artist, 5),
        _track(artist, 4, sensitive=True),
        _track(artist, 3),
        _track(artist, 2),
        _track(artist, 1),
    ]
    db_session.add_all(tracks)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=anonymous_app), base_url="http://test"
    ) as client:
        listed = await _fetch_all_pages(client, limit=2)

    assert [t["title"] for t in listed] == [
        "Track 5",
        "Track 3",
        "Track 2",
        "Track 1",
    ]


async def test_pages_fill_past_filtered_tracks(
    anonymous_app: FastAPI,
    db_session: AsyncSession,
    artist: Artist,
):
    """the scan continues past hidden rows so pages come back full."""
    tracks = [
        _track(artist, 4),
        _track(artist, 3, sensitive=True),
        _track(artist, 2, sensitive=True),
        _track(artist, 1),
    ]
    db_session.add_all(tracks)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=anonymous_app), base_url="http://test"
    ) as client:
        response = await client.get("/tracks/", params={"limit": 2})

    assert response.status_code == 200
    data = response.json()
    assert [t["title"] for t in data["tracks"]] == ["Track 4", "Track 1"]
    assert data["has_more"] is False
    assert data["next_cursor"] is None


async def test_trailing_sensitive_tracks_terminate_cleanly(
    anonymous_app: FastAPI,
    db_session: AsyncSession,
    artist: Artist,
):
    """a feed tail of only sensitive tracks ends with has_more=false."""
    tracks = [
        _track(artist, 3),
        _track(artist, 2, sensitive=True),
        _track(artist, 1, sensitive=True),
    ]
    db_session.add_all(tracks)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=anonymous_app), base_url="http://test"
    ) as client:
        listed = await _fetch_all_pages(client, limit=1)

    assert [t["title"] for t in listed] == ["Track 3"]
