"""tests for copyright moderation integration."""

from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.moderation import (
    _call_moderation_service,
    _store_scan_result,
    get_active_copyright_labels,
    scan_track_for_copyright,
)
from backend.models import Artist, CopyrightScan, Track


@pytest.fixture
def mock_moderation_response() -> dict:
    """typical response from moderation service."""
    return {
        "matches": [
            {
                "artist": "Test Artist",
                "title": "Test Song",
                "score": 85,
                "isrc": "USRC12345678",
            }
        ],
        "is_flagged": True,
        "highest_score": 85,
        "raw_response": {"status": "success", "result": []},
    }


@pytest.fixture
def mock_clear_response() -> dict:
    """response when no copyright matches found."""
    return {
        "matches": [],
        "is_flagged": False,
        "highest_score": 0,
        "raw_response": {"status": "success", "result": None},
    }


async def test_call_moderation_service_success(
    mock_moderation_response: dict,
) -> None:
    """test successful call to moderation service."""
    # use regular Mock for response since httpx Response methods are sync
    mock_response = Mock()
    mock_response.json.return_value = mock_moderation_response
    mock_response.raise_for_status.return_value = None

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response

        with patch("backend._internal.moderation.settings") as mock_settings:
            mock_settings.moderation.service_url = "https://test.example.com"
            mock_settings.moderation.auth_token = "test-token"
            mock_settings.moderation.timeout_seconds = 30

            result = await _call_moderation_service("https://example.com/audio.mp3")

    assert result == mock_moderation_response
    mock_post.assert_called_once()
    call_kwargs = mock_post.call_args
    assert call_kwargs.kwargs["json"] == {"audio_url": "https://example.com/audio.mp3"}
    assert call_kwargs.kwargs["headers"] == {"X-Moderation-Key": "test-token"}


async def test_call_moderation_service_timeout() -> None:
    """test timeout handling."""
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.TimeoutException("timeout")

        with patch("backend._internal.moderation.settings") as mock_settings:
            mock_settings.moderation.service_url = "https://test.example.com"
            mock_settings.moderation.auth_token = "test-token"
            mock_settings.moderation.timeout_seconds = 30

            with pytest.raises(httpx.TimeoutException):
                await _call_moderation_service("https://example.com/audio.mp3")


async def test_store_scan_result_flagged(
    db_session: AsyncSession,
    mock_moderation_response: dict,
) -> None:
    """test storing a flagged scan result."""
    # create test artist and track
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

    await _store_scan_result(track.id, mock_moderation_response)

    # verify scan was stored
    result = await db_session.execute(
        select(CopyrightScan).where(CopyrightScan.track_id == track.id)
    )
    scan = result.scalar_one()

    assert scan.is_flagged is True
    assert scan.highest_score == 85
    assert len(scan.matches) == 1
    assert scan.matches[0]["artist"] == "Test Artist"


async def test_store_scan_result_flagged_emits_label(
    db_session: AsyncSession,
    mock_moderation_response: dict,
) -> None:
    """test that flagged scan result emits ATProto label."""
    # create test artist and track with ATProto URI
    artist = Artist(
        did="did:plc:labelertest",
        handle="labeler.bsky.social",
        display_name="Labeler Test User",
    )
    db_session.add(artist)
    await db_session.commit()

    track = Track(
        title="Labeler Test Track",
        file_id="labeler_test_file",
        file_type="mp3",
        artist_did=artist.did,
        r2_url="https://example.com/audio.mp3",
        atproto_record_uri="at://did:plc:labelertest/fm.plyr.track/abc123",
        atproto_record_cid="bafyreiabc123",
    )
    db_session.add(track)
    await db_session.commit()

    with patch(
        "backend._internal.moderation._emit_copyright_label",
        new_callable=AsyncMock,
    ) as mock_emit:
        await _store_scan_result(track.id, mock_moderation_response)

        # verify label emission was called with full context
        mock_emit.assert_called_once_with(
            uri="at://did:plc:labelertest/fm.plyr.track/abc123",
            cid="bafyreiabc123",
            track_id=track.id,
            track_title="Labeler Test Track",
            artist_handle="labeler.bsky.social",
            artist_did="did:plc:labelertest",
            highest_score=85,
            matches=[
                {
                    "artist": "Test Artist",
                    "title": "Test Song",
                    "score": 85,
                    "isrc": "USRC12345678",
                }
            ],
        )


async def test_store_scan_result_flagged_no_atproto_uri_skips_label(
    db_session: AsyncSession,
    mock_moderation_response: dict,
) -> None:
    """test that flagged scan without ATProto URI skips label emission."""
    # create test artist and track without ATProto URI
    artist = Artist(
        did="did:plc:nouri",
        handle="nouri.bsky.social",
        display_name="No URI User",
    )
    db_session.add(artist)
    await db_session.commit()

    track = Track(
        title="No URI Track",
        file_id="nouri_file",
        file_type="mp3",
        artist_did=artist.did,
        r2_url="https://example.com/audio.mp3",
        # no atproto_record_uri
    )
    db_session.add(track)
    await db_session.commit()

    with patch(
        "backend._internal.moderation._emit_copyright_label",
        new_callable=AsyncMock,
    ) as mock_emit:
        await _store_scan_result(track.id, mock_moderation_response)

        # label emission should not be called
        mock_emit.assert_not_called()


async def test_store_scan_result_clear(
    db_session: AsyncSession,
    mock_clear_response: dict,
) -> None:
    """test storing a clear (no matches) scan result."""
    # create test artist and track
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

    await _store_scan_result(track.id, mock_clear_response)

    # verify scan was stored
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
            "backend._internal.moderation._call_moderation_service"
        ) as mock_call:
            await scan_track_for_copyright(1, "https://example.com/audio.mp3")

            # should not call the service when disabled
            mock_call.assert_not_called()


async def test_scan_track_no_auth_token() -> None:
    """test that scanning is skipped when auth token not configured."""
    with patch("backend._internal.moderation.settings") as mock_settings:
        mock_settings.moderation.enabled = True
        mock_settings.moderation.auth_token = ""

        with patch(
            "backend._internal.moderation._call_moderation_service"
        ) as mock_call:
            await scan_track_for_copyright(1, "https://example.com/audio.mp3")

            # should not call the service without auth token
            mock_call.assert_not_called()


async def test_scan_track_service_error_stores_as_clear(
    db_session: AsyncSession,
) -> None:
    """test that service errors are stored as clear results."""
    # create test artist and track
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
            "backend._internal.moderation._call_moderation_service",
            new_callable=AsyncMock,
        ) as mock_call:
            mock_call.side_effect = httpx.HTTPStatusError(
                "502 error",
                request=AsyncMock(),
                response=AsyncMock(status_code=502),
            )

            # should not raise - stores error as clear
            await scan_track_for_copyright(track.id, "https://example.com/short.mp3")

    # verify scan was stored as clear with error info
    result = await db_session.execute(
        select(CopyrightScan).where(CopyrightScan.track_id == track.id)
    )
    scan = result.scalar_one()

    assert scan.is_flagged is False
    assert scan.highest_score == 0
    assert scan.matches == []
    assert "error" in scan.raw_response
    assert scan.raw_response["status"] == "scan_failed"


async def test_scan_track_full_flow(
    db_session: AsyncSession,
    mock_moderation_response: dict,
) -> None:
    """test complete scan flow from track to stored result."""
    # create test artist and track
    artist = Artist(
        did="did:plc:fullflow",
        handle="fullflow.bsky.social",
        display_name="Full Flow User",
    )
    db_session.add(artist)
    await db_session.commit()

    track = Track(
        title="Full Flow Track",
        file_id="fullflow_file",
        file_type="flac",
        artist_did=artist.did,
        r2_url="https://example.com/fullflow.flac",
    )
    db_session.add(track)
    await db_session.commit()

    with patch("backend._internal.moderation.settings") as mock_settings:
        mock_settings.moderation.enabled = True
        mock_settings.moderation.auth_token = "test-token"
        mock_settings.moderation.service_url = "https://test.example.com"
        mock_settings.moderation.timeout_seconds = 30

        with patch(
            "backend._internal.moderation._call_moderation_service",
            new_callable=AsyncMock,
        ) as mock_call:
            mock_call.return_value = mock_moderation_response

            assert track.r2_url is not None
            await scan_track_for_copyright(track.id, track.r2_url)

    # verify scan was stored (need fresh session query)
    result = await db_session.execute(
        select(CopyrightScan).where(CopyrightScan.track_id == track.id)
    )
    scan = result.scalar_one()

    assert scan.is_flagged is True
    assert scan.highest_score == 85


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
        "at://did:plc:test/fm.plyr.track/1",
        "at://did:plc:test/fm.plyr.track/2",
        "at://did:plc:test/fm.plyr.track/3",
    ]

    mock_response = Mock()
    mock_response.json.return_value = {
        "active_uris": ["at://did:plc:test/fm.plyr.track/1"]  # only one is active
    }
    mock_response.raise_for_status.return_value = None

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response

        with patch("backend._internal.moderation.settings") as mock_settings:
            mock_settings.moderation.enabled = True
            mock_settings.moderation.auth_token = "test-token"
            mock_settings.moderation.labeler_url = "https://labeler.example.com"
            mock_settings.moderation.timeout_seconds = 10

            result = await get_active_copyright_labels(uris)

    # only the active URI should be in the result
    assert result == {"at://did:plc:test/fm.plyr.track/1"}

    # verify correct endpoint was called
    call_kwargs = mock_post.call_args
    assert "/admin/active-labels" in str(call_kwargs)
    assert call_kwargs.kwargs["json"] == {"uris": uris}


async def test_get_active_copyright_labels_service_error() -> None:
    """test that service errors return all URIs as active (fail closed)."""
    uris = ["at://did:plc:test/fm.plyr.track/1", "at://did:plc:test/fm.plyr.track/2"]

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.ConnectError("connection failed")

        with patch("backend._internal.moderation.settings") as mock_settings:
            mock_settings.moderation.enabled = True
            mock_settings.moderation.auth_token = "test-token"
            mock_settings.moderation.labeler_url = "https://labeler.example.com"
            mock_settings.moderation.timeout_seconds = 10

            result = await get_active_copyright_labels(uris)

    # should fail closed - all URIs treated as active
    assert result == set(uris)
