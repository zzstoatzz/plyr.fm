"""a failed PDS save must always say why.

regression: a batch of 18 reported "11 saved, 1 skipped, 6 failed" with an
empty error list and nothing in telemetry. the six had been ingested from the
firehose, so their audio was never in this deployment's bucket and
`storage.head_file` returned None — one of four early returns that bumped
`failed_count` and returned without recording a reason or logging.
"""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.pds_save_tasks import save_tracks_to_pds
from backend.models import Artist, Track

_DID = "did:plc:pds_save_reporting"
_SESSION_ID = "session-under-test"


class _Session:
    did = _DID
    session_id = _SESSION_ID
    handle = "saver.test"


@pytest.fixture
async def track(db_session: AsyncSession) -> Track:
    db_session.add(Artist(did=_DID, handle="saver.test", display_name="Saver"))
    await db_session.commit()

    track = Track(
        title="ingested from elsewhere",
        # firehose-ingested rows carry the record rkey, not an upload hash —
        # nothing under that key exists in this environment's bucket
        file_id="3mskqx26ked22",
        file_type="webm",
        artist_did=_DID,
        r2_url="https://audio.plyr.fm/audio/3mskqx26ked22_hashed.webm",
        atproto_record_uri=f"at://{_DID}/fm.plyr.track/3mskqx26ked22",
    )
    db_session.add(track)
    await db_session.commit()
    return track


async def _run_save(track_id: int, head_file: AsyncMock | None = None) -> dict:
    """run a save whose audio is absent from storage; return the job result."""
    captured: dict = {}

    async def _capture(save_id, status, message, **kwargs):
        if result := kwargs.get("result"):
            captured.update(result)

    with (
        patch(
            "backend._internal.pds_save_tasks.get_session",
            new=AsyncMock(return_value=_Session()),
        ),
        patch(
            "backend._internal.pds_save_tasks.storage.head_file",
            new=head_file or AsyncMock(return_value=None),
        ),
        patch(
            "backend._internal.pds_save_tasks.job_service.update_progress",
            new=AsyncMock(side_effect=_capture),
        ),
    ):
        await save_tracks_to_pds("save-1", _SESSION_ID, [track_id])

    return captured


async def test_missing_audio_failure_reports_a_reason(track: Track) -> None:
    result = await _run_save(track.id)

    assert result["failed_count"] == 1
    assert result["saved_count"] == 0

    # the whole point: a counted failure carries an explanation
    assert result["errors"], "a failure was counted with no error recorded"
    assert "ingested from elsewhere" in result["errors"][0]
    assert "plyr.fm storage" in result["errors"][0]

    assert result["failure_summary"] == [
        "1 track: audio isn't in plyr.fm storage, so there's nothing to copy"
    ]


async def test_no_failure_is_counted_without_an_explanation(track: Track) -> None:
    """the invariant, stated directly: failed_count and the reasons agree."""
    result = await _run_save(track.id)

    counted_in_summary = sum(
        int(entry.split(" ", 1)[0]) for entry in result["failure_summary"]
    )
    assert counted_in_summary == result["failed_count"]


async def test_ingested_track_is_looked_up_by_its_real_storage_key(
    track: Track, monkeypatch: pytest.MonkeyPatch
) -> None:
    """the save must ask storage for the key in `r2_url`, not the record rkey.

    this is the bug behind the "6 failed" batch: the bytes were in the bucket
    under their content hash the whole time, and we asked for `audio/<rkey>`.
    """
    from backend.config import settings

    monkeypatch.setattr(
        settings.storage, "r2_public_bucket_url", "https://audio.plyr.fm"
    )
    head_file = AsyncMock(return_value=None)

    await _run_save(track.id, head_file=head_file)

    head_file.assert_awaited_once_with("3mskqx26ked22_hashed", "webm")
