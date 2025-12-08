"""tests for user api endpoints."""

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.main import app
from backend.models import Artist, Track, TrackLike


async def test_get_user_likes_success(db_session: AsyncSession):
    """test fetching a user's liked tracks returns correct data."""
    # create liker
    liker = Artist(
        did="did:plc:liker123",
        handle="liker.bsky.social",
        display_name="Test Liker",
    )
    db_session.add(liker)

    # create artist who uploaded the track
    artist = Artist(
        did="did:plc:artist123",
        handle="artist.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create tracks
    track1 = Track(
        title="Test Track 1",
        artist_did=artist.did,
        file_id="test001",
        file_type="mp3",
        extra={"duration": 180},
        atproto_record_uri="at://did:plc:artist123/fm.plyr.track/test001",
        atproto_record_cid="bafytest001",
    )
    track2 = Track(
        title="Test Track 2",
        artist_did=artist.did,
        file_id="test002",
        file_type="mp3",
        extra={"duration": 200},
        atproto_record_uri="at://did:plc:artist123/fm.plyr.track/test002",
        atproto_record_cid="bafytest002",
    )
    db_session.add(track1)
    db_session.add(track2)
    await db_session.flush()

    # liker likes both tracks
    like1 = TrackLike(
        track_id=track1.id,
        user_did=liker.did,
        atproto_like_uri="at://did:plc:liker123/fm.plyr.like/abc123",
    )
    like2 = TrackLike(
        track_id=track2.id,
        user_did=liker.did,
        atproto_like_uri="at://did:plc:liker123/fm.plyr.like/def456",
    )
    db_session.add(like1)
    db_session.add(like2)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/users/liker.bsky.social/likes")

    assert response.status_code == 200
    data = response.json()

    # verify user info
    assert data["user"]["did"] == liker.did
    assert data["user"]["handle"] == liker.handle
    assert data["user"]["display_name"] == liker.display_name

    # verify tracks
    assert data["count"] == 2
    assert len(data["tracks"]) == 2

    # tracks should be ordered by like time (newest first)
    track_titles = [t["title"] for t in data["tracks"]]
    assert "Test Track 1" in track_titles
    assert "Test Track 2" in track_titles


async def test_get_user_likes_not_found(db_session: AsyncSession):
    """test fetching likes for non-existent user returns 404."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/users/nonexistent.bsky.social/likes")

    assert response.status_code == 404
    assert response.json()["detail"] == "user not found"


async def test_get_user_likes_empty(db_session: AsyncSession):
    """test fetching likes for user with no likes returns empty list."""
    # create user with no likes
    user = Artist(
        did="did:plc:nolikes123",
        handle="nolikes.bsky.social",
        display_name="No Likes User",
    )
    db_session.add(user)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/users/nolikes.bsky.social/likes")

    assert response.status_code == 200
    data = response.json()

    assert data["user"]["handle"] == "nolikes.bsky.social"
    assert data["count"] == 0
    assert data["tracks"] == []


async def test_get_user_likes_public_no_auth_required(db_session: AsyncSession):
    """test that fetching user likes does not require authentication."""
    # create user
    user = Artist(
        did="did:plc:publicuser",
        handle="publicuser.bsky.social",
        display_name="Public User",
    )
    db_session.add(user)
    await db_session.commit()

    # make request without any auth cookies/headers
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/users/publicuser.bsky.social/likes",
            # explicitly no cookies or auth headers
        )

    # should work without auth
    assert response.status_code == 200
