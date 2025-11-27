"""tests for track comment api endpoints."""

from collections.abc import Generator
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Artist, Track, TrackComment, UserPreferences


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:commenter123"):
        self.did = did
        self.handle = "commenter.bsky.social"
        self.session_id = "test_session_id"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": "commenter.bsky.social",
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
async def test_artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:artist123",
        handle="artist.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


@pytest.fixture
async def test_track(db_session: AsyncSession, test_artist: Artist) -> Track:
    """create a test track."""
    track = Track(
        title="Test Track",
        artist_did=test_artist.did,
        file_id="test123",
        file_type="mp3",
        extra={"duration": 180},
        atproto_record_uri="at://did:plc:artist123/fm.plyr.track/test123",
        atproto_record_cid="bafytest123",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    return track


@pytest.fixture
async def artist_with_comments_enabled(
    db_session: AsyncSession, test_artist: Artist
) -> UserPreferences:
    """create user preferences with comments enabled."""
    prefs = UserPreferences(
        did=test_artist.did,
        allow_comments=True,
    )
    db_session.add(prefs)
    await db_session.commit()
    return prefs


@pytest.fixture
async def commenter_artist(db_session: AsyncSession) -> Artist:
    """create the artist record for the commenter."""
    artist = Artist(
        did="did:test:commenter123",
        handle="commenter.bsky.social",
        display_name="Test Commenter",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""

    async def mock_require_auth() -> Session:
        return MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth
    yield app
    app.dependency_overrides.clear()


async def test_get_comments_returns_empty_when_disabled(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test that comments endpoint returns empty list when artist has comments disabled."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/tracks/{test_track.id}/comments")

    assert response.status_code == 200
    data = response.json()
    assert data["comments"] == []
    assert data["comments_enabled"] is False


async def test_get_comments_returns_list_when_enabled(
    test_app: FastAPI,
    db_session: AsyncSession,
    test_track: Track,
    artist_with_comments_enabled: UserPreferences,
):
    """test that comments endpoint returns comments when enabled."""
    # add a test comment directly to DB
    comment = TrackComment(
        track_id=test_track.id,
        user_did="did:test:commenter123",
        text="great track!",
        timestamp_ms=45000,
        atproto_comment_uri="at://did:test:commenter123/fm.plyr.comment/abc",
    )
    db_session.add(comment)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/tracks/{test_track.id}/comments")

    assert response.status_code == 200
    data = response.json()
    assert data["comments_enabled"] is True
    assert len(data["comments"]) == 1
    assert data["comments"][0]["text"] == "great track!"
    assert data["comments"][0]["timestamp_ms"] == 45000


async def test_create_comment_fails_when_comments_disabled(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test that creating a comment fails when artist has comments disabled."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/tracks/{test_track.id}/comments",
            json={"text": "hello", "timestamp_ms": 1000},
        )

    assert response.status_code == 403
    assert "disabled" in response.json()["detail"].lower()


async def test_create_comment_success(
    test_app: FastAPI,
    db_session: AsyncSession,
    test_track: Track,
    artist_with_comments_enabled: UserPreferences,
    commenter_artist: Artist,
):
    """test successful comment creation."""
    with patch("backend.api.tracks.comments.create_comment_record") as mock_create:
        mock_create.return_value = "at://did:test:commenter123/fm.plyr.comment/xyz"

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                f"/tracks/{test_track.id}/comments",
                json={"text": "awesome drop at this moment!", "timestamp_ms": 30000},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["text"] == "awesome drop at this moment!"
    assert data["timestamp_ms"] == 30000
    assert data["user_did"] == "did:test:commenter123"

    # verify ATProto record was created
    mock_create.assert_called_once()

    # verify DB entry
    result = await db_session.execute(
        select(TrackComment).where(TrackComment.track_id == test_track.id)
    )
    comment = result.scalar_one()
    assert comment.text == "awesome drop at this moment!"
    assert comment.timestamp_ms == 30000


async def test_create_comment_respects_limit(
    test_app: FastAPI,
    db_session: AsyncSession,
    test_track: Track,
    artist_with_comments_enabled: UserPreferences,
):
    """test that comment limit is enforced."""
    # add 20 comments (the limit)
    for i in range(20):
        comment = TrackComment(
            track_id=test_track.id,
            user_did=f"did:test:user{i}",
            text=f"comment {i}",
            timestamp_ms=i * 1000,
            atproto_comment_uri=f"at://did:test:user{i}/fm.plyr.comment/{i}",
        )
        db_session.add(comment)
    await db_session.commit()

    # try to add 21st comment
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/tracks/{test_track.id}/comments",
            json={"text": "one more", "timestamp_ms": 21000},
        )

    assert response.status_code == 400
    assert "maximum" in response.json()["detail"].lower()


async def test_comments_ordered_by_timestamp(
    test_app: FastAPI,
    db_session: AsyncSession,
    test_track: Track,
    artist_with_comments_enabled: UserPreferences,
):
    """test that comments are returned ordered by timestamp."""
    # add comments out of order
    for timestamp in [30000, 10000, 50000, 20000]:
        comment = TrackComment(
            track_id=test_track.id,
            user_did="did:test:user",
            text=f"at {timestamp}",
            timestamp_ms=timestamp,
            atproto_comment_uri=f"at://did:test:user/fm.plyr.comment/{timestamp}",
        )
        db_session.add(comment)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/tracks/{test_track.id}/comments")

    assert response.status_code == 200
    comments = response.json()["comments"]
    timestamps = [c["timestamp_ms"] for c in comments]
    assert timestamps == [10000, 20000, 30000, 50000]


async def test_get_comments_track_not_found(test_app: FastAPI):
    """test that 404 is returned for non-existent track."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/tracks/99999/comments")

    assert response.status_code == 404


async def test_edit_comment_success(
    test_app: FastAPI,
    db_session: AsyncSession,
    test_track: Track,
    artist_with_comments_enabled: UserPreferences,
    commenter_artist: Artist,
):
    """test that comment owner can edit their comment and ATProto record is updated."""
    from unittest.mock import AsyncMock, patch

    comment = TrackComment(
        track_id=test_track.id,
        user_did="did:test:commenter123",
        text="original text",
        timestamp_ms=5000,
        atproto_comment_uri="at://did:test:commenter123/fm.plyr.comment/edit1",
    )
    db_session.add(comment)
    await db_session.commit()
    await db_session.refresh(comment)

    with patch(
        "backend.api.tracks.comments.update_comment_record", new_callable=AsyncMock
    ) as mock_update:
        mock_update.return_value = "bafynewcid"

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.patch(
                f"/tracks/comments/{comment.id}",
                json={"text": "edited text"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["text"] == "edited text"
    assert data["updated_at"] is not None

    # verify ATProto record was updated
    mock_update.assert_called_once()
    call_kwargs = mock_update.call_args.kwargs
    assert call_kwargs["comment_uri"] == comment.atproto_comment_uri
    assert call_kwargs["subject_uri"] == test_track.atproto_record_uri
    assert call_kwargs["subject_cid"] == test_track.atproto_record_cid
    assert call_kwargs["text"] == "edited text"
    assert call_kwargs["timestamp_ms"] == 5000


async def test_edit_comment_syncs_to_atproto(
    test_app: FastAPI,
    db_session: AsyncSession,
    test_track: Track,
    artist_with_comments_enabled: UserPreferences,
    commenter_artist: Artist,
):
    """regression test: editing a comment must update the ATProto record."""
    from unittest.mock import AsyncMock, patch

    comment = TrackComment(
        track_id=test_track.id,
        user_did="did:test:commenter123",
        text="original text",
        timestamp_ms=12345,
        atproto_comment_uri="at://did:test:commenter123/fm.plyr.comment/sync1",
    )
    db_session.add(comment)
    await db_session.commit()
    await db_session.refresh(comment)
    original_created_at = comment.created_at

    with patch(
        "backend.api.tracks.comments.update_comment_record", new_callable=AsyncMock
    ) as mock_update:
        mock_update.return_value = "bafynewcid123"

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.patch(
                f"/tracks/comments/{comment.id}",
                json={"text": "updated via edit"},
            )

    assert response.status_code == 200

    # verify ATProto sync happened with correct data
    mock_update.assert_called_once()
    call_kwargs = mock_update.call_args.kwargs

    # subject must reference the track's ATProto record
    assert call_kwargs["subject_uri"] == test_track.atproto_record_uri
    assert call_kwargs["subject_cid"] == test_track.atproto_record_cid

    # original timestamp_ms and created_at preserved
    assert call_kwargs["timestamp_ms"] == 12345
    assert call_kwargs["created_at"] == original_created_at

    # new text and updated_at passed
    assert call_kwargs["text"] == "updated via edit"
    assert "updated_at" in call_kwargs  # updated_at should be set


async def test_edit_comment_forbidden_for_other_user(
    test_app: FastAPI,
    db_session: AsyncSession,
    test_track: Track,
    artist_with_comments_enabled: UserPreferences,
):
    """test that non-owner cannot edit comment."""
    comment = TrackComment(
        track_id=test_track.id,
        user_did="did:plc:other",
        text="someone else's comment",
        timestamp_ms=5000,
        atproto_comment_uri="at://did:plc:other/fm.plyr.comment/other1",
    )
    db_session.add(comment)
    await db_session.commit()
    await db_session.refresh(comment)

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.patch(
            f"/tracks/comments/{comment.id}",
            json={"text": "trying to edit"},
        )

    assert response.status_code == 403
    assert "own" in response.json()["detail"]


async def test_delete_comment_success(
    test_app: FastAPI,
    db_session: AsyncSession,
    test_track: Track,
    artist_with_comments_enabled: UserPreferences,
    commenter_artist: Artist,
):
    """test that comment owner can delete their comment."""
    from unittest.mock import AsyncMock, patch

    comment = TrackComment(
        track_id=test_track.id,
        user_did="did:test:commenter123",
        text="to be deleted",
        timestamp_ms=5000,
        atproto_comment_uri="at://did:test:commenter123/fm.plyr.comment/del1",
    )
    db_session.add(comment)
    await db_session.commit()
    await db_session.refresh(comment)
    comment_id = comment.id

    with patch(
        "backend.api.tracks.comments.delete_record_by_uri", new_callable=AsyncMock
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/tracks/comments/{comment_id}")

    assert response.status_code == 200
    assert response.json()["deleted"] is True

    result = await db_session.execute(
        select(TrackComment).where(TrackComment.id == comment_id)
    )
    assert result.scalar_one_or_none() is None
