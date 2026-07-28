"""a tag containing a slash must be reachable.

The bug this pins (#1662): "7/4" and "funk / soul" are legitimate tags -- a time
signature and a genre pair -- but neither could be opened. The frontend
percent-encodes the name, and the ASGI layer decodes it once *before* routing, so
`/tracks/tags/7%2F4` arrives as `/tracks/tags/7/4` and matches no route. The
request 404s in the router, before the handler that would have found the tag.

Slash is the only character with this problem: `?`, `#`, `%` and space all survive
the decode and reach the handler intact, which is why this is a routing fix and not
an encoding one. The tests below request the path the server actually sees -- with
a literal slash -- because that is what the decode produces.
"""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, get_optional_session
from backend.main import app
from backend.models import Artist, Tag, Track, TrackTag, get_db


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    artist = Artist(
        did="did:plc:slashartist",
        handle="slash.bsky.social",
        display_name="Slash Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
async def time_signature_tag(db_session: AsyncSession, artist: Artist) -> Tag:
    """the tag from the original report."""
    tag = Tag(name="7/4", created_by_did=artist.did)
    db_session.add(tag)
    await db_session.commit()
    await db_session.refresh(tag)
    return tag


@pytest.fixture
async def tagged_track(
    db_session: AsyncSession, artist: Artist, time_signature_tag: Tag
) -> Track:
    track = Track(
        title="Seven Four",
        artist_did=artist.did,
        file_id="sevenfour123",
        file_type="mp3",
        extra={"duration": 297},
        atproto_record_uri="at://did:plc:slashartist/fm.plyr.track/sevenfour123",
        atproto_record_cid="bafysevenfour123",
    )
    db_session.add(track)
    await db_session.flush()
    db_session.add(TrackTag(track_id=track.id, tag_id=time_signature_tag.id))
    await db_session.commit()
    await db_session.refresh(track)
    return track


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    async def mock_get_optional_session() -> Session | None:
        return None

    async def mock_get_db():
        yield db_session

    app.dependency_overrides[get_optional_session] = mock_get_optional_session
    app.dependency_overrides[get_db] = mock_get_db
    yield app
    app.dependency_overrides.clear()


async def test_tag_with_slash_resolves(test_app: FastAPI, tagged_track: Track) -> None:
    """The regression: this 404'd in the router before the fix."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/tracks/tags/7/4")

    assert response.status_code == 200
    body = response.json()
    assert body["tag"]["name"] == "7/4"
    assert [t["title"] for t in body["tracks"]] == ["Seven Four"]


async def test_tag_with_spaces_around_slash_resolves(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    """The other affected tag in production: 'funk / soul'."""
    db_session.add(Tag(name="funk / soul", created_by_did=artist.did))
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/tracks/tags/funk / soul")

    assert response.status_code == 200
    assert response.json()["tag"]["name"] == "funk / soul"


async def test_a_missing_tag_still_reports_the_full_name(test_app: FastAPI) -> None:
    """The 404 must name what was actually looked up, not a truncated prefix.

    A greedy `:path` that stopped at the slash would report "7" here, which would
    send the next person debugging this in the wrong direction.
    """
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/tracks/tags/9/8")

    assert response.status_code == 404
    assert response.json()["detail"] == "tag '9/8' not found"


async def test_ordinary_tags_are_unaffected(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    """`:path` must not change how a normal tag resolves."""
    db_session.add(Tag(name="jazz", created_by_did=artist.did))
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/tracks/tags/jazz")

    assert response.status_code == 200
    assert response.json()["tag"]["name"] == "jazz"


async def test_the_tag_list_endpoint_still_routes(
    test_app: FastAPI, db_session: AsyncSession, artist: Artist
) -> None:
    """`/tags/{name:path}` is greedy; it must not swallow `/tags` itself."""
    db_session.add(Tag(name="ambient", created_by_did=artist.did))
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/tracks/tags")

    assert response.status_code == 200
    assert isinstance(response.json(), list)
