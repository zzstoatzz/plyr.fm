"""Owner-only listening must not expose a work to other viewers."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, get_optional_session
from backend._internal.queue import QueueService
from backend._internal.tasks.hooks import run_post_track_create_hooks
from backend._internal.track_visibility import can_view_track, visible_filter
from backend.main import app
from backend.models import Artist, Track, TrackComment, TrackLike


@pytest.fixture
async def owner_track(db_session: AsyncSession) -> Track:
    db_session.add(
        Artist(
            did="did:test:owner-only", handle="owner-only.test", display_name="Owner"
        )
    )
    await db_session.flush()
    track = Track(
        title="hidden owner work",
        artist_did="did:test:owner-only",
        file_id="owner-only-audio",
        file_type="mp3",
        visibility="public",
        support_gate={"type": "owner"},
        audio_storage="r2_private",
        download_policy="off",
    )
    db_session.add(track)
    await db_session.commit()
    return track


@pytest.mark.parametrize("viewer", [None, "did:test:other", "did:test:owner-only"])
async def test_owner_visibility_rules(
    db_session: AsyncSession, owner_track: Track, viewer: str | None
) -> None:
    session = None
    if viewer:
        session = Session.__new__(Session)
        session.did = viewer
    expected = viewer == owner_track.artist_did
    assert await can_view_track(session, owner_track) == expected
    ids = (
        await db_session.scalars(select(Track.id).where(await visible_filter(session)))
    ).all()
    assert (owner_track.id in ids) == expected


@pytest.mark.parametrize(
    "path",
    [
        "/tracks/{id}",
        "/tracks/{id}/likes",
        "/tracks/{id}/comments",
        "/audio/{file_id}",
        "/audio/{file_id}/url",
        "/audio/{file_id}/download",
    ],
)
async def test_owner_track_anonymous_endpoints(
    client: TestClient, db_session: AsyncSession, owner_track: Track, path: str
) -> None:
    async def anonymous() -> None:
        return None

    app.dependency_overrides[get_optional_session] = anonymous
    try:
        response = client.get(
            path.format(id=owner_track.id, file_id=owner_track.file_id)
        )
        assert response.status_code == 404, response.text
    finally:
        app.dependency_overrides.pop(get_optional_session, None)


@pytest.mark.parametrize(
    "path",
    [
        "/tracks/?limit=100",
        "/tracks/?artist_did=did:test:owner-only",
        "/search?q=hidden",
        "/activity/",
    ],
)
async def test_owner_track_absent_from_public_surfaces(
    client: TestClient, db_session: AsyncSession, owner_track: Track, path: str
) -> None:
    response = client.get(path)
    assert response.status_code == 200, response.text
    assert owner_track.title not in response.text


async def test_cached_queue_rechecks_owner_only_transition(
    db_session: AsyncSession, owner_track: Track
) -> None:
    service = QueueService()
    owner_track.support_gate = None
    await db_session.commit()
    viewer = "did:test:other"
    before = await service._hydrate_tracks(db_session, [owner_track.file_id], viewer)
    assert [track["id"] for track in before] == [owner_track.id]
    service.cache[viewer] = ({"track_ids": [owner_track.file_id]}, 1, before)
    owner_track.support_gate = {"type": "owner"}
    await db_session.commit()
    cached = await service.get_queue(viewer)
    assert cached is not None and cached[2] == []
    own = await service._hydrate_tracks(
        db_session, [owner_track.file_id], owner_track.artist_did
    )
    assert [track["id"] for track in own] == [owner_track.id]


@pytest.mark.parametrize("private_space", [False, True])
async def test_activity_hides_existing_engagement_after_restriction(
    client: TestClient,
    db_session: AsyncSession,
    owner_track: Track,
    private_space: bool,
) -> None:
    db_session.add(TrackLike(track_id=owner_track.id, user_did=owner_track.artist_did))
    db_session.add(
        TrackComment(
            track_id=owner_track.id,
            user_did=owner_track.artist_did,
            text="hidden comment",
            timestamp_ms=0,
        )
    )
    if private_space:
        owner_track.support_gate = None
        owner_track.visibility = "private"
    await db_session.commit()
    cursor = (datetime.now(UTC) + timedelta(minutes=1)).isoformat()
    for params in ({}, {"cursor": cursor}):
        response = client.get("/activity/", params=params)
        assert response.status_code == 200
        assert owner_track.title not in response.text
        assert "hidden comment" not in response.text


async def test_owner_only_upload_suppresses_public_hooks(
    db_session: AsyncSession, owner_track: Track
) -> None:
    await run_post_track_create_hooks(owner_track.id)
    await db_session.refresh(owner_track)
    assert owner_track.notification_sent


async def test_cached_radio_drops_a_newly_owner_only_track(
    client: TestClient, db_session: AsyncSession, owner_track: Track
) -> None:
    owner_track.support_gate = None
    owner_track.extra = {"duration": 120}
    await db_session.commit()
    first = client.get("/radio/state?catalog_only=true").json()
    assert owner_track.id in {track["id"] for track in first["rotation"]}
    owner_track.support_gate = {"type": "owner"}
    await db_session.commit()
    second = client.get("/radio/state?catalog_only=true")
    assert second.status_code == 200
    assert owner_track.title not in second.text
