"""tests for aggregation utilities."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Artist, CopyrightScan, Track, TrackLike
from backend.utilities.aggregations import get_copyright_info, get_like_counts


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


# tests for get_copyright_info


@pytest.fixture
async def flagged_track(db_session: AsyncSession) -> Track:
    """create a track with a copyright flag."""
    artist = Artist(
        did="did:plc:flagged",
        handle="flagged.bsky.social",
        display_name="Flagged Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Flagged Track",
        artist_did=artist.did,
        file_id="flagged_file",
        file_type="mp3",
        atproto_record_uri="at://did:plc:flagged/fm.plyr.track/abc123",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    # add copyright scan with flag
    scan = CopyrightScan(
        track_id=track.id,
        is_flagged=True,
        highest_score=90,
        matches=[{"title": "Copyrighted Song", "artist": "Famous Artist", "score": 90}],
    )
    db_session.add(scan)
    await db_session.commit()

    return track


async def test_get_copyright_info_flagged(
    db_session: AsyncSession, flagged_track: Track
) -> None:
    """test that flagged scans are returned as flagged.

    get_copyright_info is now a pure read - it reads the is_flagged state
    directly from the database. the sync_copyright_resolutions background
    task is responsible for updating is_flagged based on labeler state.
    """
    result = await get_copyright_info(db_session, [flagged_track.id])

    assert flagged_track.id in result
    assert result[flagged_track.id].is_flagged is True
    assert result[flagged_track.id].primary_match == "Copyrighted Song by Famous Artist"


async def test_get_copyright_info_not_flagged(
    db_session: AsyncSession, flagged_track: Track
) -> None:
    """test that resolved scans (is_flagged=False) are returned as not flagged."""
    from sqlalchemy import select

    # update scan to be not flagged (simulates sync_copyright_resolutions running)
    scan = await db_session.scalar(
        select(CopyrightScan).where(CopyrightScan.track_id == flagged_track.id)
    )
    assert scan is not None
    scan.is_flagged = False
    await db_session.commit()

    result = await get_copyright_info(db_session, [flagged_track.id])

    assert flagged_track.id in result
    assert result[flagged_track.id].is_flagged is False
    assert result[flagged_track.id].primary_match is None


async def test_get_copyright_info_empty_list(db_session: AsyncSession) -> None:
    """test that empty track list returns empty dict."""
    result = await get_copyright_info(db_session, [])
    assert result == {}


async def test_get_copyright_info_no_scan(
    db_session: AsyncSession, test_tracks: list[Track]
) -> None:
    """test that tracks without copyright scans are not included."""
    # test_tracks fixture doesn't create copyright scans
    track_ids = [track.id for track in test_tracks]

    result = await get_copyright_info(db_session, track_ids)

    # no tracks should be in result since none have scans
    assert result == {}
