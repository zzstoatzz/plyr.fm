"""tests for aggregation utilities."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Artist, Track, TrackLike
from backend.utilities.aggregations import get_like_counts


@pytest.fixture
async def test_tracks(db_session: AsyncSession) -> list[Track]:
    """create test tracks with varying like counts."""
    # create artist
    artist = Artist(
        did="did:plc:artist123",
        handle="artist.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create tracks
    tracks = []
    for i in range(3):
        track = Track(
            title=f"Track {i}",
            artist_did=artist.did,
            file_id=f"file_{i}",
            file_type="mp3",
            atproto_record_uri=f"at://did:plc:artist123/fm.plyr.track/{i}",
            atproto_record_cid=f"cid_{i}",
        )
        db_session.add(track)
        tracks.append(track)

    await db_session.commit()

    # refresh to get IDs
    for track in tracks:
        await db_session.refresh(track)

    # create likes:
    # track 0: 2 likes
    # track 1: 1 like
    # track 2: 0 likes
    likes = [
        TrackLike(
            track_id=tracks[0].id,
            user_did="did:test:user1",
            atproto_like_uri="at://did:test:user1/fm.plyr.like/1",
        ),
        TrackLike(
            track_id=tracks[0].id,
            user_did="did:test:user2",
            atproto_like_uri="at://did:test:user2/fm.plyr.like/1",
        ),
        TrackLike(
            track_id=tracks[1].id,
            user_did="did:test:user1",
            atproto_like_uri="at://did:test:user1/fm.plyr.like/2",
        ),
    ]

    for like in likes:
        db_session.add(like)

    await db_session.commit()

    return tracks


async def test_get_like_counts_multiple_tracks(
    db_session: AsyncSession, test_tracks: list[Track]
):
    """test getting like counts for multiple tracks."""
    track_ids = [track.id for track in test_tracks]
    counts = await get_like_counts(db_session, track_ids)

    assert counts[test_tracks[0].id] == 2
    assert counts[test_tracks[1].id] == 1
    # track 2 has no likes, so it won't be in the dict
    assert test_tracks[2].id not in counts


async def test_get_like_counts_empty_list(db_session: AsyncSession):
    """test that empty track list returns empty dict."""
    counts = await get_like_counts(db_session, [])
    assert counts == {}


async def test_get_like_counts_no_likes(
    db_session: AsyncSession, test_tracks: list[Track]
):
    """test tracks with no likes return empty dict."""
    # only query track 2 which has no likes
    counts = await get_like_counts(db_session, [test_tracks[2].id])
    assert counts == {}


async def test_get_like_counts_single_track(
    db_session: AsyncSession, test_tracks: list[Track]
):
    """test getting like count for a single track."""
    counts = await get_like_counts(db_session, [test_tracks[0].id])
    assert counts[test_tracks[0].id] == 2
