"""tests for RSS feed endpoints."""

from xml.etree import ElementTree

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Artist, Track
from backend.models.album import Album


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:feed_test_artist",
        handle="feed-test.bsky.social",
        display_name="Feed Test Artist",
        avatar_url="https://example.com/avatar.jpg",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


@pytest.fixture
async def public_tracks(db_session: AsyncSession, artist: Artist) -> list[Track]:
    """create public tracks (no support_gate)."""
    tracks = [
        Track(
            title="Public Track 1",
            artist_did=artist.did,
            file_id="feed_pub1",
            file_type="mp3",
            r2_url="https://cdn.example.com/feed_pub1.mp3",
            extra={"duration": 180},
            description="first track description",
        ),
        Track(
            title="Public Track 2",
            artist_did=artist.did,
            file_id="feed_pub2",
            file_type="mp3",
            r2_url="https://cdn.example.com/feed_pub2.mp3",
            extra={"duration": 240},
        ),
    ]
    for track in tracks:
        db_session.add(track)
    await db_session.commit()
    return tracks


@pytest.fixture
async def gated_track(db_session: AsyncSession, artist: Artist) -> Track:
    """create a supporter-gated track."""
    track = Track(
        title="Gated Track",
        artist_did=artist.did,
        file_id="feed_gated",
        file_type="mp3",
        support_gate={"type": "any"},
    )
    db_session.add(track)
    await db_session.commit()
    return track


@pytest.fixture
async def album_with_tracks(
    db_session: AsyncSession, artist: Artist
) -> tuple[Album, list[Track]]:
    """create an album with tracks."""
    album = Album(
        artist_did=artist.did,
        slug="test-album",
        title="Test Album",
        description="a test album",
    )
    db_session.add(album)
    await db_session.flush()

    tracks = [
        Track(
            title="Album Track 1",
            artist_did=artist.did,
            file_id="feed_alb1",
            file_type="mp3",
            r2_url="https://cdn.example.com/feed_alb1.mp3",
            album_id=album.id,
            extra={"duration": 120},
        ),
        Track(
            title="Album Track 2",
            artist_did=artist.did,
            file_id="feed_alb2",
            file_type="mp3",
            r2_url="https://cdn.example.com/feed_alb2.mp3",
            album_id=album.id,
            extra={"duration": 200},
        ),
    ]
    for track in tracks:
        db_session.add(track)
    await db_session.commit()
    return album, tracks


def _parse_rss(content: bytes) -> ElementTree.Element:
    """parse RSS XML and return the root element."""
    return ElementTree.fromstring(content)


async def test_artist_feed_returns_rss(
    client: TestClient,
    artist: Artist,
    public_tracks: list[Track],
) -> None:
    """artist feed returns valid RSS XML with public tracks."""
    response = client.get(f"/feeds/artist/{artist.handle}")
    assert response.status_code == 200
    assert "application/rss+xml" in response.headers["content-type"]

    root = _parse_rss(response.content)
    assert root.tag == "rss"

    channel = root.find("channel")
    assert channel is not None
    assert channel.findtext("title") == f"{artist.display_name} on plyr.fm"

    items = channel.findall("item")
    assert len(items) == 2


async def test_artist_feed_excludes_gated_tracks(
    client: TestClient,
    artist: Artist,
    public_tracks: list[Track],
    gated_track: Track,
) -> None:
    """artist feed excludes supporter-gated tracks."""
    response = client.get(f"/feeds/artist/{artist.handle}")
    assert response.status_code == 200

    root = _parse_rss(response.content)
    channel = root.find("channel")
    assert channel is not None
    items = channel.findall("item")
    # only public tracks, not gated
    assert len(items) == 2
    titles = {item.findtext("title") for item in items}
    assert "Gated Track" not in titles


async def test_artist_feed_includes_description(
    client: TestClient,
    artist: Artist,
    public_tracks: list[Track],
) -> None:
    """artist feed includes track description when present."""
    response = client.get(f"/feeds/artist/{artist.handle}")
    root = _parse_rss(response.content)
    channel = root.find("channel")
    assert channel is not None
    items = channel.findall("item")

    descriptions = [item.findtext("description") for item in items]
    assert "first track description" in descriptions


async def test_artist_feed_404_for_unknown_handle(client: TestClient) -> None:
    """artist feed returns 404 for nonexistent artist."""
    response = client.get("/feeds/artist/nonexistent.bsky.social")
    assert response.status_code == 404


async def test_album_feed_returns_rss(
    client: TestClient,
    artist: Artist,
    album_with_tracks: tuple[Album, list[Track]],
) -> None:
    """album feed returns valid RSS XML with album tracks."""
    album, _tracks = album_with_tracks
    response = client.get(f"/feeds/album/{artist.handle}/{album.slug}")
    assert response.status_code == 200
    assert "application/rss+xml" in response.headers["content-type"]

    root = _parse_rss(response.content)
    channel = root.find("channel")
    assert channel is not None
    assert "Test Album" in (channel.findtext("title") or "")

    items = channel.findall("item")
    assert len(items) == 2


async def test_album_feed_404_for_unknown(client: TestClient) -> None:
    """album feed returns 404 for nonexistent album."""
    response = client.get("/feeds/album/nobody.bsky.social/no-album")
    assert response.status_code == 404


async def test_artist_feed_has_enclosure(
    client: TestClient,
    artist: Artist,
    public_tracks: list[Track],
) -> None:
    """RSS items include enclosure with audio URL."""
    response = client.get(f"/feeds/artist/{artist.handle}")
    root = _parse_rss(response.content)
    channel = root.find("channel")
    assert channel is not None
    items = channel.findall("item")
    assert len(items) > 0

    enclosure = items[0].find("enclosure")
    assert enclosure is not None
    assert enclosure.get("url", "").startswith("https://")
    assert enclosure.get("type") == "audio/mpeg"


async def test_artist_feed_extensionless_avatar_url(
    client: TestClient,
    db_session: AsyncSession,
    public_tracks: list[Track],
) -> None:
    """artist feed does not 500 when avatar URL has no file extension (e.g. Bluesky CDN)."""
    # update artist avatar to an extensionless Bluesky CDN URL
    artist = (
        await db_session.execute(
            select(Artist).where(Artist.did == "did:plc:feed_test_artist")
        )
    ).scalar_one()
    artist.avatar_url = "https://cdn.bsky.app/img/avatar/plain/did:plc:abc123/bafkreibvouwftoeioineclc2ldmkajtu5au4yypan3lfkotouxvb7m5cu4"
    await db_session.commit()

    response = client.get(f"/feeds/artist/{artist.handle}")
    assert response.status_code == 200

    root = _parse_rss(response.content)
    channel = root.find("channel")
    assert channel is not None
    # RSS <image> should be absent (extensionless URL not supported by RSS spec)
    assert channel.find("image") is None
    # but itunes:image should still be present
    itunes_ns = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd"}
    itunes_img = channel.find("itunes:image", itunes_ns)
    assert itunes_img is not None
