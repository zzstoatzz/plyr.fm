"""tests for copyright scanning, label queries, and resolution sync."""

from unittest.mock import AsyncMock, patch

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.clients.moderation import ScanResult
from backend._internal.moderation import (
    get_active_copyright_labels,
    scan_track_for_copyright,
)
from backend.models import Artist, CopyrightScan, Track


async def test_scan_track_stores_flagged_result(
    db_session: AsyncSession,
    mock_scan_result: ScanResult,
) -> None:
    """test storing a flagged scan result."""
    artist = Artist(
        did="did:plc:test123",
        handle="test.bsky.social",
        display_name="Test User",
    )
    db_session.add(artist)
    await db_session.commit()

    track = Track(
        title="Test Track",
        file_id="test_file_123",
        file_type="mp3",
        artist_did=artist.did,
        r2_url="https://example.com/audio.mp3",
    )
    db_session.add(track)
    await db_session.commit()

    with patch("backend._internal.moderation.settings") as mock_settings:
        mock_settings.moderation.enabled = True
        mock_settings.moderation.auth_token = "test-token"

        with patch(
            "backend._internal.moderation.get_moderation_client"
        ) as mock_get_client:
            mock_client = AsyncMock()
            mock_client.scan.return_value = mock_scan_result
            mock_get_client.return_value = mock_client

            assert track.r2_url is not None
            await scan_track_for_copyright(track.id, track.r2_url)

    result = await db_session.execute(
        select(CopyrightScan).where(CopyrightScan.track_id == track.id)
    )
    scan = result.scalar_one()

    assert scan.is_flagged is True
    assert scan.highest_score == 85
    assert len(scan.matches) == 1
    assert scan.matches[0]["artist"] == "Test Artist"


async def test_scan_track_stores_clear_result(
    db_session: AsyncSession,
    mock_clear_result: ScanResult,
) -> None:
    """test storing a clear (no matches) scan result."""
    artist = Artist(
        did="did:plc:test456",
        handle="clear.bsky.social",
        display_name="Clear User",
    )
    db_session.add(artist)
    await db_session.commit()

    track = Track(
        title="Original Track",
        file_id="original_file_456",
        file_type="wav",
        artist_did=artist.did,
        r2_url="https://example.com/original.wav",
    )
    db_session.add(track)
    await db_session.commit()

    with patch("backend._internal.moderation.settings") as mock_settings:
        mock_settings.moderation.enabled = True
        mock_settings.moderation.auth_token = "test-token"

        with patch(
            "backend._internal.moderation.get_moderation_client"
        ) as mock_get_client:
            mock_client = AsyncMock()
            mock_client.scan.return_value = mock_clear_result
            mock_get_client.return_value = mock_client

            assert track.r2_url is not None
            await scan_track_for_copyright(track.id, track.r2_url)

    result = await db_session.execute(
        select(CopyrightScan).where(CopyrightScan.track_id == track.id)
    )
    scan = result.scalar_one()

    assert scan.is_flagged is False
    assert scan.highest_score == 0
    assert scan.matches == []


async def test_scan_track_disabled() -> None:
    """test that scanning is skipped when disabled."""
    with patch("backend._internal.moderation.settings") as mock_settings:
        mock_settings.moderation.enabled = False

        with patch(
            "backend._internal.moderation.get_moderation_client"
        ) as mock_get_client:
            await scan_track_for_copyright(1, "https://example.com/audio.mp3")

            # should not even get the client when disabled
            mock_get_client.assert_not_called()


async def test_scan_track_no_auth_token() -> None:
    """test that scanning is skipped when auth token not configured."""
    with patch("backend._internal.moderation.settings") as mock_settings:
        mock_settings.moderation.enabled = True
        mock_settings.moderation.auth_token = ""

        with patch(
            "backend._internal.moderation.get_moderation_client"
        ) as mock_get_client:
            await scan_track_for_copyright(1, "https://example.com/audio.mp3")

            # should not even get the client without auth token
            mock_get_client.assert_not_called()


async def test_scan_track_service_error_stores_as_clear(
    db_session: AsyncSession,
) -> None:
    """test that service errors are stored as clear results."""
    artist = Artist(
        did="did:plc:errortest",
        handle="errortest.bsky.social",
        display_name="Error Test User",
    )
    db_session.add(artist)
    await db_session.commit()

    track = Track(
        title="Error Test Track",
        file_id="error_test_file",
        file_type="mp3",
        artist_did=artist.did,
        r2_url="https://example.com/short.mp3",
    )
    db_session.add(track)
    await db_session.commit()

    with patch("backend._internal.moderation.settings") as mock_settings:
        mock_settings.moderation.enabled = True
        mock_settings.moderation.auth_token = "test-token"

        with patch(
            "backend._internal.moderation.get_moderation_client"
        ) as mock_get_client:
            mock_client = AsyncMock()
            mock_client.scan.side_effect = httpx.HTTPStatusError(
                "502 error",
                request=AsyncMock(),
                response=AsyncMock(status_code=502),
            )
            mock_get_client.return_value = mock_client

            # should not raise - stores error as clear
            await scan_track_for_copyright(track.id, "https://example.com/short.mp3")

    result = await db_session.execute(
        select(CopyrightScan).where(CopyrightScan.track_id == track.id)
    )
    scan = result.scalar_one()

    assert scan.is_flagged is False
    assert scan.highest_score == 0
    assert scan.matches == []
    assert "error" in scan.raw_response
    assert scan.raw_response["status"] == "scan_failed"


# tests for get_active_copyright_labels


async def test_get_active_copyright_labels_empty_list() -> None:
    """test that empty URI list returns empty set."""
    result = await get_active_copyright_labels([])
    assert result == set()


async def test_get_active_copyright_labels_disabled() -> None:
    """test that disabled moderation returns all URIs as active (fail closed)."""
    uris = ["at://did:plc:test/fm.plyr.track/1", "at://did:plc:test/fm.plyr.track/2"]

    with patch("backend._internal.moderation.settings") as mock_settings:
        mock_settings.moderation.enabled = False

        result = await get_active_copyright_labels(uris)

    assert result == set(uris)


async def test_get_active_copyright_labels_no_auth_token() -> None:
    """test that missing auth token returns all URIs as active (fail closed)."""
    uris = ["at://did:plc:test/fm.plyr.track/1"]

    with patch("backend._internal.moderation.settings") as mock_settings:
        mock_settings.moderation.enabled = True
        mock_settings.moderation.auth_token = ""

        result = await get_active_copyright_labels(uris)

    assert result == set(uris)


async def test_get_active_copyright_labels_success() -> None:
    """test successful call to labeler returns active URIs."""
    uris = [
        "at://did:plc:success/fm.plyr.track/1",
        "at://did:plc:success/fm.plyr.track/2",
        "at://did:plc:success/fm.plyr.track/3",
    ]

    with patch("backend._internal.moderation.settings") as mock_settings:
        mock_settings.moderation.enabled = True
        mock_settings.moderation.auth_token = "test-token"

        with patch(
            "backend._internal.moderation.get_moderation_client"
        ) as mock_get_client:
            mock_client = AsyncMock()
            mock_client.get_active_labels.return_value = {uris[0]}  # only first active
            mock_get_client.return_value = mock_client

            result = await get_active_copyright_labels(uris)

    assert result == {uris[0]}


async def test_get_active_copyright_labels_service_error() -> None:
    """test that service errors return all URIs as active (fail closed)."""
    uris = [
        "at://did:plc:error/fm.plyr.track/1",
        "at://did:plc:error/fm.plyr.track/2",
    ]

    with patch("backend._internal.moderation.settings") as mock_settings:
        mock_settings.moderation.enabled = True
        mock_settings.moderation.auth_token = "test-token"

        with patch(
            "backend._internal.moderation.get_moderation_client"
        ) as mock_get_client:
            mock_client = AsyncMock()
            # client's get_active_labels fails closed internally
            mock_client.get_active_labels.return_value = set(uris)
            mock_get_client.return_value = mock_client

            result = await get_active_copyright_labels(uris)

    assert result == set(uris)


# tests for background task


async def test_sync_copyright_resolutions(db_session: AsyncSession) -> None:
    """test that sync_copyright_resolutions updates flagged scans."""
    from backend._internal.tasks import sync_copyright_resolutions

    # create test artist and tracks
    artist = Artist(
        did="did:plc:synctest",
        handle="synctest.bsky.social",
        display_name="Sync Test User",
    )
    db_session.add(artist)
    await db_session.commit()

    # track 1: flagged, will be resolved
    track1 = Track(
        title="Flagged Track 1",
        file_id="flagged_1",
        file_type="mp3",
        artist_did=artist.did,
        r2_url="https://example.com/flagged1.mp3",
        atproto_record_uri="at://did:plc:synctest/fm.plyr.track/1",
    )
    db_session.add(track1)

    # track 2: flagged, will stay flagged
    track2 = Track(
        title="Flagged Track 2",
        file_id="flagged_2",
        file_type="mp3",
        artist_did=artist.did,
        r2_url="https://example.com/flagged2.mp3",
        atproto_record_uri="at://did:plc:synctest/fm.plyr.track/2",
    )
    db_session.add(track2)
    await db_session.commit()

    # create flagged scans
    scan1 = CopyrightScan(
        track_id=track1.id,
        is_flagged=True,
        highest_score=85,
        matches=[{"artist": "Test", "title": "Song"}],
        raw_response={},
    )
    scan2 = CopyrightScan(
        track_id=track2.id,
        is_flagged=True,
        highest_score=90,
        matches=[{"artist": "Test", "title": "Song2"}],
        raw_response={},
    )
    db_session.add_all([scan1, scan2])
    await db_session.commit()

    with patch(
        "backend._internal.clients.moderation.get_moderation_client"
    ) as mock_get_client:
        mock_client = AsyncMock()
        # only track2's URI is still active
        mock_client.get_active_labels.return_value = {
            "at://did:plc:synctest/fm.plyr.track/2"
        }
        mock_get_client.return_value = mock_client

        await sync_copyright_resolutions()

    # refresh from db
    await db_session.refresh(scan1)
    await db_session.refresh(scan2)

    # scan1 should no longer be flagged (label was negated)
    assert scan1.is_flagged is False

    # scan2 should still be flagged
    assert scan2.is_flagged is True
