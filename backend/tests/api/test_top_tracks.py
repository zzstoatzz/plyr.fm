"""tests for GET /tracks/top endpoint."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, get_optional_session
from backend.main import app
from backend.models import Artist, Tag, Track, TrackComment, TrackLike, TrackTag, get_db


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:user123"):
        self.did = did
        self.handle = "testuser.bsky.social"
        self.session_id = "test_session_id"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": "testuser.bsky.social",
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:topartist",
        handle="topartist.bsky.social",
        display_name="Top Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
async def tracks_with_likes(db_session: AsyncSession, artist: Artist) -> list[Track]:
    """create tracks with varying like counts.

    track 0: 3 likes (most popular)
    track 1: 1 like
    track 2: 2 likes
    track 3: 0 likes (should not appear)
    """
    tracks = []
    for i in range(4):
        track = Track(
            title=f"Top Track {i}",
            artist_did=artist.did,
            file_id=f"topfile_{i}",
            file_type="mp3",
            extra={"duration": 180},
            atproto_record_uri=f"at://did:plc:topartist/fm.plyr.track/top{i}",
            atproto_record_cid=f"bafytop{i}",
        )
        db_session.add(track)
        tracks.append(track)

    await db_session.flush()

    # track 0: 3 likes
    for j in range(3):
        db_session.add(
            TrackLike(
                track_id=tracks[0].id,
                user_did=f"did:test:liker{j}",
                atproto_like_uri=f"at://did:test:liker{j}/fm.plyr.like/t0",
            )
        )

    # track 1: 1 like
    db_session.add(
        TrackLike(
            track_id=tracks[1].id,
            user_did="did:test:liker0",
            atproto_like_uri="at://did:test:liker0/fm.plyr.like/t1",
        )
    )

    # track 2: 2 likes
    for j in range(2):
        db_session.add(
            TrackLike(
                track_id=tracks[2].id,
                user_did=f"did:test:liker{j}",
                atproto_like_uri=f"at://did:test:liker{j}/fm.plyr.like/t2",
            )
        )

    # track 3: 0 likes (no TrackLike rows)

    await db_session.commit()
    for track in tracks:
        await db_session.refresh(track)

    return tracks


@pytest.fixture
async def track_with_comment(
    db_session: AsyncSession, tracks_with_likes: list[Track]
) -> Track:
    """add a comment to tracks_with_likes[0]."""
    db_session.add(
        TrackComment(
            track_id=tracks_with_likes[0].id,
            user_did="did:test:commenter",
            text="great track",
            timestamp_ms=1000,
            atproto_comment_uri="at://did:test:commenter/fm.plyr.comment/c1",
        )
    )
    await db_session.commit()
    return tracks_with_likes[0]


@pytest.fixture
async def track_with_tag(
    db_session: AsyncSession, artist: Artist, tracks_with_likes: list[Track]
) -> Track:
    """add a tag to tracks_with_likes[0]."""
    tag = Tag(name="electronic", created_by_did=artist.did)
    db_session.add(tag)
    await db_session.flush()

    db_session.add(TrackTag(track_id=tracks_with_likes[0].id, tag_id=tag.id))
    await db_session.commit()
    return tracks_with_likes[0]


@pytest.fixture
async def user_liked_track(
    db_session: AsyncSession, tracks_with_likes: list[Track]
) -> TrackLike:
    """make the test user like tracks_with_likes[2]."""
    like = TrackLike(
        track_id=tracks_with_likes[2].id,
        user_did="did:test:user123",
        atproto_like_uri="at://did:test:user123/fm.plyr.like/t2",
    )
    db_session.add(like)
    await db_session.commit()
    await db_session.refresh(like)
    return like


@pytest.fixture
def authenticated_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """test app with authenticated session."""

    async def mock_get_optional_session() -> Session | None:
        return MockSession()

    async def mock_get_db():
        yield db_session

    app.dependency_overrides[get_optional_session] = mock_get_optional_session
    app.dependency_overrides[get_db] = mock_get_db

    yield app

    app.dependency_overrides.clear()


@pytest.fixture
def unauthenticated_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """test app with no session (unauthenticated)."""

    async def mock_get_optional_session() -> Session | None:
        return None

    async def mock_get_db():
        yield db_session

    app.dependency_overrides[get_optional_session] = mock_get_optional_session
    app.dependency_overrides[get_db] = mock_get_db

    yield app

    app.dependency_overrides.clear()


async def test_top_tracks_ordered_by_like_count(
    authenticated_app: FastAPI,
    tracks_with_likes: list[Track],
):
    """tracks are returned ordered by like count, most liked first."""
    async with AsyncClient(
        transport=ASGITransport(app=authenticated_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/tracks/top")

    assert response.status_code == 200
    tracks = response.json()
    titles = [t["title"] for t in tracks]

    # track 0 (3 likes) > track 2 (2 likes) > track 1 (1 like)
    assert titles == ["Top Track 0", "Top Track 2", "Top Track 1"]
    # track 3 (0 likes) should not appear
    assert "Top Track 3" not in titles


async def test_top_tracks_empty_when_no_likes(
    authenticated_app: FastAPI,
    artist: Artist,
):
    """returns empty list when no tracks have likes."""
    async with AsyncClient(
        transport=ASGITransport(app=authenticated_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/tracks/top")

    assert response.status_code == 200
    assert response.json() == []


async def test_top_tracks_limit_clamped(
    authenticated_app: FastAPI,
    tracks_with_likes: list[Track],
):
    """limit parameter is clamped to 1-50."""
    async with AsyncClient(
        transport=ASGITransport(app=authenticated_app),
        base_url="http://test",
    ) as client:
        # limit=0 should be clamped to 1
        response = await client.get("/tracks/top?limit=0")
        assert response.status_code == 200
        assert len(response.json()) == 1

        # limit=100 should be clamped to 50 (but we only have 3 liked tracks)
        response = await client.get("/tracks/top?limit=100")
        assert response.status_code == 200
        assert len(response.json()) == 3

        # limit=2 should return exactly 2
        response = await client.get("/tracks/top?limit=2")
        assert response.status_code == 200
        assert len(response.json()) == 2


async def test_top_tracks_unauthenticated_is_liked_false(
    unauthenticated_app: FastAPI,
    tracks_with_likes: list[Track],
):
    """unauthenticated users see is_liked=False for all tracks."""
    async with AsyncClient(
        transport=ASGITransport(app=unauthenticated_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/tracks/top")

    assert response.status_code == 200
    tracks = response.json()
    assert all(t["is_liked"] is False for t in tracks)


async def test_top_tracks_authenticated_is_liked(
    authenticated_app: FastAPI,
    tracks_with_likes: list[Track],
    user_liked_track: TrackLike,
):
    """authenticated user sees is_liked=True for tracks they liked."""
    async with AsyncClient(
        transport=ASGITransport(app=authenticated_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/tracks/top")

    assert response.status_code == 200
    tracks = response.json()
    liked_status = {t["title"]: t["is_liked"] for t in tracks}

    # user liked track 2 (via user_liked_track fixture)
    assert liked_status["Top Track 2"] is True
    # user did not like track 0 or 1
    assert liked_status["Top Track 0"] is False
    assert liked_status["Top Track 1"] is False


async def test_top_tracks_includes_like_count(
    authenticated_app: FastAPI,
    tracks_with_likes: list[Track],
):
    """response includes correct like_count for each track."""
    async with AsyncClient(
        transport=ASGITransport(app=authenticated_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/tracks/top")

    assert response.status_code == 200
    tracks = response.json()
    counts = {t["title"]: t["like_count"] for t in tracks}

    assert counts["Top Track 0"] == 3
    assert counts["Top Track 2"] == 2
    assert counts["Top Track 1"] == 1


async def test_top_tracks_includes_comment_count(
    authenticated_app: FastAPI,
    tracks_with_likes: list[Track],
    track_with_comment: Track,
):
    """response includes correct comment_count."""
    async with AsyncClient(
        transport=ASGITransport(app=authenticated_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/tracks/top")

    assert response.status_code == 200
    tracks = response.json()
    counts = {t["title"]: t["comment_count"] for t in tracks}

    assert counts["Top Track 0"] == 1
    assert counts["Top Track 2"] == 0


async def test_top_tracks_includes_tags(
    authenticated_app: FastAPI,
    tracks_with_likes: list[Track],
    track_with_tag: Track,
):
    """response includes tags for each track."""
    async with AsyncClient(
        transport=ASGITransport(app=authenticated_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/tracks/top")

    assert response.status_code == 200
    tracks = response.json()
    tags_by_title = {t["title"]: t["tags"] for t in tracks}

    assert "electronic" in tags_by_title["Top Track 0"]
    assert tags_by_title["Top Track 1"] == []
