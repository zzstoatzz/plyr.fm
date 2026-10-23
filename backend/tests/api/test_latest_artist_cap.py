"""the latest feed shows at most a few tracks per artist per calendar week."""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import get_optional_session
from backend.api.tracks.constants import LATEST_TRACKS_PER_ARTIST_PER_WEEK
from backend.main import app
from backend.models import Artist, Tag, Track, TrackTag, get_db

# conftest clears rows created after the test began, so every date is future
MONDAY = datetime(2031, 3, 3, 12, tzinfo=UTC)
CAP = LATEST_TRACKS_PER_ARTIST_PER_WEEK
# requests pass an explicit limit, which skips the anonymous discovery cache


@pytest.fixture
def anonymous_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    async def no_session() -> None:
        return None

    async def get_test_db():
        yield db_session

    app.dependency_overrides[get_optional_session] = no_session
    app.dependency_overrides[get_db] = get_test_db
    yield app
    app.dependency_overrides.clear()


async def _artist(db: AsyncSession, handle: str) -> Artist:
    artist = Artist(
        did=f"did:plc:{handle}", handle=f"{handle}.example", display_name=handle
    )
    db.add(artist)
    await db.flush()
    return artist


async def _track(db: AsyncSession, artist: Artist, title: str, at: datetime) -> Track:
    track = Track(
        title=title,
        artist_did=artist.did,
        file_id=f"cap_{title}",
        file_type="mp3",
        extra={"duration": 60},
        atproto_record_uri=f"at://{artist.did}/fm.plyr.track/{title}",
        atproto_record_cid=f"bafy{title}",
        created_at=at,
    )
    db.add(track)
    await db.flush()
    return track


async def _get(app_: FastAPI, **params: str | int) -> dict:
    async with AsyncClient(
        transport=ASGITransport(app=app_), base_url="http://test"
    ) as client:
        response = await client.get("/tracks/", params=params)
    assert response.status_code == 200, response.text
    return response.json()


async def test_latest_keeps_an_artists_newest_tracks_each_week(
    anonymous_app: FastAPI, db_session: AsyncSession
) -> None:
    prolific = await _artist(db_session, "prolific")
    other = await _artist(db_session, "other")
    for i in range(CAP + 2):
        await _track(db_session, prolific, f"mix{i}", MONDAY + timedelta(hours=i))
    await _track(db_session, other, "song", MONDAY + timedelta(days=1))
    await db_session.commit()

    titles = [
        t["title"]
        for t in (await _get(anonymous_app, limit=50))["tracks"]
        if t["artist_did"] in {prolific.did, other.did}
    ]

    assert titles.count("song") == 1
    assert [t for t in titles if t.startswith("mix")] == [
        f"mix{i}" for i in range(CAP + 1, 1, -1)
    ]


async def test_each_calendar_week_gets_its_own_allowance(
    anonymous_app: FastAPI, db_session: AsyncSession
) -> None:
    prolific = await _artist(db_session, "prolific")
    for week in range(2):
        for i in range(CAP):
            at = MONDAY + timedelta(weeks=week, hours=i)
            await _track(db_session, prolific, f"w{week}t{i}", at)
    await db_session.commit()

    tracks = (await _get(anonymous_app, limit=50))["tracks"]
    assert sum(t["artist_did"] == prolific.did for t in tracks) == 2 * CAP


async def test_artist_page_is_not_capped(
    anonymous_app: FastAPI, db_session: AsyncSession
) -> None:
    prolific = await _artist(db_session, "prolific")
    for i in range(CAP + 2):
        await _track(db_session, prolific, f"mix{i}", MONDAY + timedelta(hours=i))
    await db_session.commit()

    tracks = (await _get(anonymous_app, artist_did=prolific.did))["tracks"]
    assert len(tracks) == CAP + 2


async def test_cap_holds_across_pages(
    anonymous_app: FastAPI, db_session: AsyncSession
) -> None:
    """ranks are computed before the cursor, so paging never re-admits a track."""
    prolific = await _artist(db_session, "prolific")
    other = await _artist(db_session, "other")
    for i in range(CAP + 3):
        await _track(db_session, prolific, f"mix{i}", MONDAY + timedelta(hours=2 * i))
        await _track(db_session, other, f"song{i}", MONDAY + timedelta(hours=2 * i + 1))
    await db_session.commit()

    seen: list[str] = []
    cursor: str | None = None
    while True:
        params: dict[str, str | int] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = await _get(anonymous_app, **params)
        assert len(page["tracks"]) == 2 or not page["has_more"]
        seen += [t["title"] for t in page["tracks"]]
        if not (cursor := page["next_cursor"]):
            break

    assert sum(t.startswith("mix") for t in seen) == CAP
    assert sum(t.startswith("song") for t in seen) == CAP
    assert len(seen) == len(set(seen))


async def test_hidden_tracks_do_not_use_up_the_allowance(
    anonymous_app: FastAPI, db_session: AsyncSession
) -> None:
    prolific = await _artist(db_session, "prolific")
    tag = Tag(name="ai", created_by_did=prolific.did)
    db_session.add(tag)
    await db_session.flush()
    for i in range(CAP):
        await _track(db_session, prolific, f"mix{i}", MONDAY + timedelta(hours=i))
    hidden = await _track(db_session, prolific, "generated", MONDAY + timedelta(days=2))
    db_session.add(TrackTag(track_id=hidden.id, tag_id=tag.id))
    await db_session.commit()

    titles = [
        t["title"]
        for t in (await _get(anonymous_app, limit=50))["tracks"]
        if t["artist_did"] == prolific.did
    ]
    assert sorted(titles) == [f"mix{i}" for i in range(CAP)]
