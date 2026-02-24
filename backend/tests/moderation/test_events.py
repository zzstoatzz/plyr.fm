"""tests for moderation event publishing to Redis stream."""

import json
from unittest.mock import AsyncMock, patch

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.clients.moderation import ScanResult
from backend._internal.moderation import scan_track_for_copyright
from backend.models import Artist, CopyrightScan, Track


async def test_publish_moderation_event_on_scan_result(
    db_session: AsyncSession,
    mock_scan_result: ScanResult,
) -> None:
    """test that copyright scan publishes event to moderation:actions stream."""
    artist = Artist(
        did="did:plc:streamtest",
        handle="streamtest.bsky.social",
        display_name="Stream Test User",
    )
    db_session.add(artist)
    await db_session.commit()

    track = Track(
        title="Stream Test Track",
        file_id="stream_test_file",
        file_type="mp3",
        artist_did=artist.did,
        r2_url="https://example.com/stream.mp3",
        atproto_record_uri="at://did:plc:streamtest/fm.plyr.track/abc",
    )
    db_session.add(track)
    await db_session.commit()

    mock_redis = AsyncMock()
    mock_redis.xadd = AsyncMock()

    with (
        patch("backend._internal.moderation.settings") as mock_settings,
        patch("backend._internal.moderation.get_moderation_client") as mock_get_client,
        patch("backend._internal.moderation.get_async_redis_client") as mock_get_redis,
    ):
        mock_settings.moderation.enabled = True
        mock_settings.moderation.auth_token = "test-token"

        mock_client = AsyncMock()
        mock_client.scan.return_value = mock_scan_result
        mock_get_client.return_value = mock_client

        mock_get_redis.return_value = mock_redis

        assert track.r2_url is not None
        await scan_track_for_copyright(track.id, track.r2_url)

    # verify xadd was called with the right stream key
    mock_redis.xadd.assert_called_once()
    call_args = mock_redis.xadd.call_args
    assert call_args[0][0] == "moderation:actions"

    # verify payload contains expected fields
    payload = json.loads(call_args[0][1]["payload"])
    assert payload["action_type"] == "copyright_scan_completed"
    assert payload["track_id"] == track.id
    assert payload["artist_did"] == "did:plc:streamtest"
    assert payload["track_at_uri"] == "at://did:plc:streamtest/fm.plyr.track/abc"
    assert "scan" in payload
    assert payload["scan"]["match_count"] == 1


async def test_publish_moderation_event_failure_does_not_block(
    db_session: AsyncSession,
    mock_scan_result: ScanResult,
) -> None:
    """test that Redis failure doesn't prevent scan result storage."""
    artist = Artist(
        did="did:plc:redisfail",
        handle="redisfail.bsky.social",
        display_name="Redis Fail User",
    )
    db_session.add(artist)
    await db_session.commit()

    track = Track(
        title="Redis Fail Track",
        file_id="redis_fail_file",
        file_type="mp3",
        artist_did=artist.did,
        r2_url="https://example.com/redisfail.mp3",
        atproto_record_uri="at://did:plc:redisfail/fm.plyr.track/def",
    )
    db_session.add(track)
    await db_session.commit()

    mock_redis = AsyncMock()
    mock_redis.xadd = AsyncMock(side_effect=ConnectionError("redis down"))

    with (
        patch("backend._internal.moderation.settings") as mock_settings,
        patch("backend._internal.moderation.get_moderation_client") as mock_get_client,
        patch("backend._internal.moderation.get_async_redis_client") as mock_get_redis,
    ):
        mock_settings.moderation.enabled = True
        mock_settings.moderation.auth_token = "test-token"

        mock_client = AsyncMock()
        mock_client.scan.return_value = mock_scan_result
        mock_get_client.return_value = mock_client

        mock_get_redis.return_value = mock_redis

        # should not raise even though redis is down
        assert track.r2_url is not None
        await scan_track_for_copyright(track.id, track.r2_url)

    # scan result should still be stored in DB
    result = await db_session.execute(
        select(CopyrightScan).where(CopyrightScan.track_id == track.id)
    )
    scan = result.scalar_one()
    assert scan.is_flagged is True
