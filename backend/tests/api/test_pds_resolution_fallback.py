"""tests for resilient PDS record fetching with DID resolution fallback."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend._internal.atproto.records.fm_plyr.track import (
    get_record_public_resilient,
)

RECORD_URI = "at://did:plc:abc123/fm.plyr.track/rkey1"
STALE_PDS = "https://shiitake.us-east.host.bsky.network"
CORRECT_PDS = "https://eurosky.social"
RECORD_DATA = {"uri": RECORD_URI, "value": {"title": "test track"}}


async def test_resilient_retries_with_resolved_pds() -> None:
    """when the cached PDS URL fails, resolve the DID and retry."""
    mock_atproto_data = MagicMock(pds=CORRECT_PDS)

    with (
        patch(
            "backend._internal.atproto.records.fm_plyr.track.get_record_public",
            new_callable=AsyncMock,
            side_effect=[Exception("404 not found"), RECORD_DATA],
        ) as mock_get,
        patch(
            "backend._internal.atproto.records.fm_plyr.track.AsyncDidResolver"
        ) as mock_resolver_cls,
    ):
        mock_resolver = MagicMock()
        mock_resolver.resolve_atproto_data = AsyncMock(return_value=mock_atproto_data)
        mock_resolver_cls.return_value = mock_resolver

        data, resolved_url = await get_record_public_resilient(RECORD_URI, STALE_PDS)

        assert data == RECORD_DATA
        assert resolved_url == CORRECT_PDS
        # first call with stale PDS, second with resolved
        assert mock_get.call_count == 2
        mock_get.assert_any_call(RECORD_URI, STALE_PDS)
        mock_get.assert_any_call(RECORD_URI, CORRECT_PDS)


async def test_resilient_reraises_when_resolved_url_same() -> None:
    """when DID resolution returns the same PDS URL, re-raise original error."""
    mock_atproto_data = MagicMock(pds=STALE_PDS)

    with (
        patch(
            "backend._internal.atproto.records.fm_plyr.track.get_record_public",
            new_callable=AsyncMock,
            side_effect=Exception("404 not found"),
        ),
        patch(
            "backend._internal.atproto.records.fm_plyr.track.AsyncDidResolver"
        ) as mock_resolver_cls,
    ):
        mock_resolver = MagicMock()
        mock_resolver.resolve_atproto_data = AsyncMock(return_value=mock_atproto_data)
        mock_resolver_cls.return_value = mock_resolver

        with pytest.raises(Exception, match="404 not found"):
            await get_record_public_resilient(RECORD_URI, STALE_PDS)


async def test_resilient_reraises_when_no_pds_url_provided() -> None:
    """when no pds_url is provided, don't attempt DID resolution."""
    with (
        patch(
            "backend._internal.atproto.records.fm_plyr.track.get_record_public",
            new_callable=AsyncMock,
            side_effect=Exception("fetch failed"),
        ),
        pytest.raises(Exception, match="fetch failed"),
    ):
        await get_record_public_resilient(RECORD_URI, pds_url=None)


async def test_resilient_returns_none_when_first_try_succeeds() -> None:
    """when the initial fetch succeeds, resolved_pds_url is None."""
    with patch(
        "backend._internal.atproto.records.fm_plyr.track.get_record_public",
        new_callable=AsyncMock,
        return_value=RECORD_DATA,
    ):
        data, resolved_url = await get_record_public_resilient(RECORD_URI, STALE_PDS)

        assert data == RECORD_DATA
        assert resolved_url is None


async def test_resilient_reraises_when_did_resolution_fails() -> None:
    """when DID resolution itself fails, re-raise the original PDS error."""
    with (
        patch(
            "backend._internal.atproto.records.fm_plyr.track.get_record_public",
            new_callable=AsyncMock,
            side_effect=Exception("pds unreachable"),
        ),
        patch(
            "backend._internal.atproto.records.fm_plyr.track.AsyncDidResolver"
        ) as mock_resolver_cls,
    ):
        mock_resolver = MagicMock()
        mock_resolver.resolve_atproto_data = AsyncMock(
            side_effect=Exception("DID resolution failed")
        )
        mock_resolver_cls.return_value = mock_resolver

        with pytest.raises(Exception, match="pds unreachable"):
            await get_record_public_resilient(RECORD_URI, STALE_PDS)
