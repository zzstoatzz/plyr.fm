"""orchestration tests for `_process_replace_background`.

these run the background pipeline end-to-end with the I/O phases mocked,
verifying the swap is atomic, rollback works, and the right hooks fire.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.tracks.audio_replace import (
    TrackAudioState,
    _process_replace_background,
)
from backend.models import Album, Artist

from ._helpers import (
    OWNER_DID,
    TRACK_URI,
    MockSession,
    audio_info,
    make_track,
    patched_replace_pipeline,
    pds_result,
    replace_ctx,
    storage_result,
)


class TestReplaceOrchestration:
    """exercise `_process_replace_background` end-to-end with mocked phases."""

    async def test_happy_path_swaps_audio_and_updates_record(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        """on success: file_id/r2_url/atproto_record_cid/duration update,
        old R2 file is deleted, post-replace hooks fire, no notification fires."""
        track = make_track(file_id="OLD", duration=120)
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)
        track_id = track.id

        deleted_keys: list[str] = []

        async def fake_delete(file_id: str, file_type: str | None = None) -> bool:
            deleted_keys.append(file_id)
            return True

        with patched_replace_pipeline(
            store=storage_result(file_id="NEW"),
            storage_delete_side_effect=fake_delete,
        ) as mocks:
            await _process_replace_background(replace_ctx(track_id=track_id))

        # DB row was atomically swapped
        await db_session.refresh(track)
        assert track.file_id == "NEW"
        assert track.r2_url == "https://audio.example/new-file-id.mp3"
        assert track.atproto_record_cid == "bafyNEWREC"
        assert track.atproto_record_uri == TRACK_URI  # URI is stable
        assert track.extra["duration"] == 200  # new duration
        assert track.audio_storage == "both"
        assert track.pds_blob_cid == "bafyNEWBLOB"
        assert track.notification_sent is True  # never re-fires

        # old R2 file was deleted
        assert "OLD" in deleted_keys

        # post-replace hooks were scheduled with the new audio URL
        mocks["post_hooks"].assert_called_once()
        call = mocks["post_hooks"].call_args
        assert call.args[0] == track_id
        assert call.kwargs["audio_url"] == "https://audio.example/new-file-id.mp3"

    async def test_rollback_when_pds_record_update_fails(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        """if `update_record` raises, we delete the new R2 file and leave the
        track row pointing at the OLD file_id/cid — no orphan, no broken state."""
        track = make_track(file_id="OLD", record_cid="bafyOLD", duration=120)
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)
        track_id = track.id

        deleted_keys: list[str] = []

        async def fake_delete(file_id: str, file_type: str | None = None) -> bool:
            deleted_keys.append(file_id)
            return True

        with patched_replace_pipeline(
            store=storage_result(file_id="NEW"),
            update_record_side_effect=RuntimeError("PDS exploded"),
            storage_delete_side_effect=fake_delete,
        ) as mocks:
            await _process_replace_background(replace_ctx(track_id=track_id))

        # track row is unchanged
        await db_session.refresh(track)
        assert track.file_id == "OLD"
        assert track.atproto_record_cid == "bafyOLD"
        assert track.extra["duration"] == 120  # never updated

        # the new R2 file we just wrote was deleted (no orphan)
        assert "NEW" in deleted_keys
        # the old R2 file was NOT deleted
        assert "OLD" not in deleted_keys

        # post-replace hooks must not have fired
        mocks["post_hooks"].assert_not_called()

    async def test_pds_blob_too_large_fallback_keeps_r2_only(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        """when PDS upload returns a None-cid result (too large / failed), the
        track is recorded as r2-only and pds_blob_cid is cleared."""
        track = make_track(file_id="OLD")
        # simulate that the previous audio had a PDS blob
        track.pds_blob_cid = "bafyOLDBLOB"
        track.pds_blob_size = 9999
        track.audio_storage = "both"
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)
        track_id = track.id

        with patched_replace_pipeline(
            store=storage_result(file_id="NEW"),
            pds=pds_result(cid=None, size=None),
        ):
            await _process_replace_background(replace_ctx(track_id=track_id))

        await db_session.refresh(track)
        assert track.audio_storage == "r2"
        assert track.pds_blob_cid is None
        assert track.pds_blob_size is None

    async def test_album_list_resync_scheduled_when_track_in_album(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        """tracks in an album must trigger a list-record resync so the album's
        embedded strongRef carries the new track CID."""
        album = Album(artist_did=OWNER_DID, slug="my-album", title="My Album")
        db_session.add(album)
        await db_session.flush()
        track = make_track(album_id=album.id)
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)
        track_id = track.id
        album_id = album.id

        with patched_replace_pipeline(
            store=storage_result(file_id="NEW"),
        ) as mocks:
            await _process_replace_background(replace_ctx(track_id=track_id))

        mocks["schedule_album_sync"].assert_called_once()
        # second positional arg is album_id (after session_id)
        assert mocks["schedule_album_sync"].call_args.args[1] == album_id

    async def test_gated_track_record_uses_backend_audio_url(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        """gated tracks must not write a public R2 URL into the ATProto record;
        they need the auth-protected `/audio/{file_id}` redirect endpoint."""
        track = make_track(support_gate={"type": "any"})
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)
        track_id = track.id

        captured_record: dict = {}

        async def fake_update_record(
            *, auth_session, record_uri: str, record: dict
        ) -> tuple[str, str]:
            captured_record.update(record)
            return record_uri, "bafyNEWREC"

        with patched_replace_pipeline(
            validate=audio_info(is_gated=True),
            store=storage_result(file_id="NEW", r2_url=None),  # gated → r2_url=None
            pds=None,  # gated tracks skip PDS upload
            update_record_side_effect=fake_update_record,
        ):
            await _process_replace_background(replace_ctx(track_id=track_id))

        # the recorded audioUrl points at /audio/{file_id}, not at R2
        assert captured_record["audioUrl"].endswith("/audio/NEW")
        assert "supportGate" in captured_record
        assert captured_record["supportGate"] == {"type": "any"}

    async def test_lossless_replace_records_original_file_id(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        """a lossless (FLAC) replacement should store both transcoded mp3 and
        the original file id on the row."""
        track = make_track(file_id="OLD")
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)
        track_id = track.id

        with patched_replace_pipeline(
            store=storage_result(
                file_id="NEW_MP3",
                original_file_id="NEW_FLAC",
                original_file_type="flac",
            ),
        ):
            await _process_replace_background(replace_ctx(track_id=track_id))

        await db_session.refresh(track)
        assert track.file_id == "NEW_MP3"
        assert track.original_file_id == "NEW_FLAC"
        assert track.original_file_type == "flac"

    async def test_db_swap_clears_stale_genre_predictions(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        """stale genre_predictions / genre_predictions_file_id must be cleared
        on a successful audio swap so a future re-classification doesn't get
        short-circuited as 'already done'."""
        track = make_track(file_id="OLD")
        track.extra = {
            **track.extra,
            "genre_predictions": [{"name": "ambient", "confidence": 0.9}],
            "genre_predictions_file_id": "OLD",
        }
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)
        track_id = track.id

        with patched_replace_pipeline(store=storage_result(file_id="NEW")):
            await _process_replace_background(replace_ctx(track_id=track_id))

        await db_session.refresh(track)
        assert "genre_predictions" not in track.extra
        assert "genre_predictions_file_id" not in track.extra

    async def test_session_reloaded_after_pds_upload(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        """if PDS upload refreshed the OAuth token, the new session is used for
        the subsequent putRecord call (mirrors the upload-pipeline regression)."""
        track = make_track(file_id="OLD")
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)
        track_id = track.id

        refreshed = MockSession(OWNER_DID)
        refreshed.oauth_session["access_token"] = "REFRESHED-TOKEN"

        captured_session: dict = {}

        async def fake_update_record(
            *, auth_session, record_uri: str, record: dict
        ) -> tuple[str, str]:
            captured_session["token"] = auth_session.oauth_session["access_token"]
            return record_uri, "bafyNEWREC"

        with patched_replace_pipeline(
            store=storage_result(file_id="NEW"),
            update_record_side_effect=fake_update_record,
            refreshed_session=refreshed,
        ):
            await _process_replace_background(replace_ctx(track_id=track_id))

        assert captured_session["token"] == "REFRESHED-TOKEN"


def test_track_audio_state_dataclass() -> None:
    """sanity check the snapshot dataclass."""
    state = TrackAudioState(
        track_id=1,
        artist_did=OWNER_DID,
        artist_display_name="Owner",
        atproto_record_uri=TRACK_URI,
        old_file_id="OLD",
        old_file_type="mp3",
        old_original_file_id=None,
        old_original_file_type=None,
        title="My Song",
        album=None,
        duration=120,
        features=[],
        image_url=None,
        description=None,
        support_gate=None,
    )
    assert state.track_id == 1
    assert state.support_gate is None
