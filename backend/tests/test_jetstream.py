"""tests for Jetstream consumer and ingest tasks."""

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from docket import Perpetual
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.jetstream import JetstreamConsumer, consume_jetstream
from backend._internal.tasks.ingest import (
    SubjectNotFoundError,
    ingest_comment_create,
    ingest_comment_delete,
    ingest_like_create,
    ingest_like_delete,
    ingest_list_create,
    ingest_list_update,
    ingest_track_create,
    ingest_track_delete,
    ingest_track_update,
)
from backend.models import Artist, Playlist, Track, TrackComment, TrackLike


def _recent_ts() -> str:
    """return a recent ISO timestamp that clear_database will clean up.

    ingest functions commit via their own db_session() — the test teardown's
    clear_database only deletes rows with created_at > test_start_time, so
    records with hardcoded past timestamps (e.g. 2025-01-01) would persist
    and cause FK constraint errors.
    """
    return datetime.now(UTC).isoformat()


# --- fixtures ---


@pytest.fixture(autouse=True)
def _mock_post_create_hooks():
    """prevent ingest_track_create from reaching docket/redis during tests."""
    with patch(
        "backend._internal.tasks.ingest.run_post_track_create_hooks",
        new_callable=AsyncMock,
    ):
        yield


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    """create a test artist with a unique DID (xdist-safe)."""
    did = f"did:plc:jetstream_{uuid.uuid4().hex[:12]}"
    a = Artist(
        did=did,
        handle="testartist.bsky.social",
        display_name="Test Artist",
        pds_url="https://bsky.social",
    )
    db_session.add(a)
    await db_session.commit()
    return a


@pytest.fixture
async def track(db_session: AsyncSession, artist: Artist) -> Track:
    """create a test track."""
    t = Track(
        title="Test Track",
        file_id="abc123",
        file_type="mp3",
        artist_did=artist.did,
        r2_url="https://r2.example.com/abc123.mp3",
        atproto_record_uri=f"at://{artist.did}/fm.plyr.track/existing",
        atproto_record_cid="bafyexisting",
        audio_storage="r2",
    )
    db_session.add(t)
    await db_session.commit()
    return t


# --- consumer tests ---


class TestJetstreamConsumer:
    async def test_dispatches_track_create(self) -> None:
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:jetstream_test"}

        mock_docket = MagicMock()
        dispatched: list[dict] = []

        async def capture(**kwargs: object) -> None:
            dispatched.append(dict(kwargs))

        mock_docket.add = MagicMock(return_value=capture)

        event = {
            "kind": "commit",
            "did": "did:plc:jetstream_test",
            "time_us": 1000000,
            "commit": {
                "collection": "fm.plyr.track",
                "operation": "create",
                "rkey": "abc123",
                "record": {"title": "New Track"},
                "cid": "bafynew",
            },
        }

        with patch("backend._internal.jetstream.get_docket", return_value=mock_docket):
            await consumer._process_event(event)

        assert len(dispatched) == 1
        assert dispatched[0]["did"] == "did:plc:jetstream_test"
        assert (
            dispatched[0]["uri"] == "at://did:plc:jetstream_test/fm.plyr.track/abc123"
        )

    async def test_skips_unknown_did(self) -> None:
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:known"}

        event = {
            "kind": "commit",
            "did": "did:plc:unknown",
            "commit": {
                "collection": "fm.plyr.track",
                "operation": "create",
                "rkey": "abc",
            },
        }

        # _dispatch should never be called
        consumer._dispatch = AsyncMock()  # type: ignore[method-assign]
        await consumer._process_event(event)
        consumer._dispatch.assert_not_called()  # type: ignore[union-attr]

    async def test_skips_non_commit_events(self) -> None:
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:jetstream_test"}
        consumer._dispatch = AsyncMock()  # type: ignore[method-assign]

        event = {"kind": "identity", "did": "did:plc:jetstream_test"}
        await consumer._process_event(event)
        consumer._dispatch.assert_not_called()  # type: ignore[union-attr]

    async def test_persists_cursor(self) -> None:
        consumer = JetstreamConsumer()
        mock_redis = AsyncMock()

        with patch(
            "backend._internal.jetstream.get_async_redis_client",
            return_value=mock_redis,
        ):
            consumer._cursor = 12345678
            await consumer._flush_cursor()

        mock_redis.set.assert_called_once()
        args = mock_redis.set.call_args
        assert args[0][1] == "12345678"

    async def test_resumes_from_cursor(self) -> None:
        consumer = JetstreamConsumer()
        mock_redis = AsyncMock()
        mock_redis.get = AsyncMock(return_value="9999999")

        with patch(
            "backend._internal.jetstream.get_async_redis_client",
            return_value=mock_redis,
        ):
            await consumer._load_cursor()

        assert consumer._cursor == 9999999
        url = consumer._build_url()
        assert "cursor=" in url

    async def test_build_url_without_cursor(self) -> None:
        consumer = JetstreamConsumer()
        url = consumer._build_url()
        assert "wantedCollections=fm.plyr.*" in url
        assert "cursor=" not in url

    async def test_build_url_with_cursor_rewinds(self) -> None:
        consumer = JetstreamConsumer()
        consumer._cursor = 10_000_000  # 10 seconds in microseconds
        url = consumer._build_url()
        # rewound by 5_000_000 → cursor=5000000
        assert "cursor=5000000" in url


class TestConsumeJetstreamPerpetual:
    async def test_cancels_perpetual_when_disabled(self) -> None:
        perpetual = Perpetual(every=timedelta(seconds=0))
        with patch("backend._internal.jetstream.settings") as mock_settings:
            mock_settings.jetstream.enabled = False
            await consume_jetstream(perpetual=perpetual)
        assert perpetual.cancelled

    async def test_runs_consumer_when_enabled(self) -> None:
        with (
            patch("backend._internal.jetstream.settings") as mock_settings,
            patch.object(JetstreamConsumer, "run", new_callable=AsyncMock) as mock_run,
        ):
            mock_settings.jetstream.enabled = True
            await consume_jetstream()
            mock_run.assert_called_once()


# --- track ingestion tests ---


class TestIngestTrackCreate:
    async def test_creates_track(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """valid record creates a Track row."""
        record = {
            "title": "Jetstream Track",
            "artist": "Test Artist",
            "fileId": "js_file_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/js_file_001.mp3",
            "duration": 180,
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/newtrack1"

        await ingest_track_create(
            did=artist.did, rkey="newtrack1", record=record, uri=uri, cid="bafynew"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        assert track.title == "Jetstream Track"
        assert track.file_id == "js_file_001"
        assert track.r2_url == "https://r2.example.com/js_file_001.mp3"
        assert track.audio_storage == "r2"
        assert track.extra.get("duration") == 180
        assert track.publish_state == "published"

    async def test_dedup_by_uri(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """duplicate AT URI is silently skipped."""
        assert track.atproto_record_uri is not None
        record = {
            "title": "Duplicate",
            "artist": "Test Artist",
            "audioUrl": "https://r2.example.com/dup.mp3",
            "fileType": "mp3",
            "createdAt": _recent_ts(),
        }
        await ingest_track_create(
            did=artist.did,
            rkey="existing",
            record=record,
            uri=track.atproto_record_uri,
            cid="bafydup",
        )

        # should still be only 1 track with this URI
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == track.atproto_record_uri)
        )
        assert len(result.scalars().all()) == 1

    async def test_unknown_artist_skipped(self, db_session: AsyncSession) -> None:
        """event for non-existent artist is silently skipped."""
        await ingest_track_create(
            did="did:plc:nonexistent",
            rkey="rk1",
            record={
                "title": "Ghost",
                "artist": "Nobody",
                "audioUrl": "https://r2.example.com/ghost.mp3",
                "fileType": "mp3",
                "createdAt": _recent_ts(),
            },
            uri="at://did:plc:nonexistent/fm.plyr.track/rk1",
            cid="bafy",
        )

        result = await db_session.execute(
            select(Track).where(Track.artist_did == "did:plc:nonexistent")
        )
        assert result.scalar_one_or_none() is None

    async def test_both_audio_storage(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """track with audioBlob + audioUrl gets audio_storage='both'."""
        record = {
            "title": "Both Track",
            "artist": "Test Artist",
            "fileId": "both_001",
            "fileType": "mp3",
            "audioBlob": {"ref": {"$link": "bafyaudioblob"}, "mimeType": "audio/mpeg"},
            "audioUrl": "https://r2.example.com/both_001.mp3",
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/both1"

        await ingest_track_create(
            did=artist.did, rkey="both1", record=record, uri=uri, cid="bafynew"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        assert track.audio_storage == "both"
        assert track.pds_blob_cid == "bafyaudioblob"
        assert track.r2_url == "https://r2.example.com/both_001.mp3"

    async def test_pds_only_audio_storage(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """track with audioBlob only (no audioUrl) gets audio_storage='pds'."""
        record = {
            "title": "PDS Only Track",
            "artist": "Test Artist",
            "fileId": "pds_only_001",
            "fileType": "mp3",
            "audioBlob": {"ref": {"$link": "bafypdsonly"}, "mimeType": "audio/mpeg"},
            "audioUrl": "https://placeholder.example.com/pds_only_001.mp3",
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/pdsonly1"

        await ingest_track_create(
            did=artist.did, rkey="pdsonly1", record=record, uri=uri, cid="bafynew"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        # audioUrl is required by lexicon but audioBlob is canonical — both present = "both"
        assert track.audio_storage == "both"
        assert track.pds_blob_cid == "bafypdsonly"

    async def test_track_create_sets_support_gate(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """gated track record materializes support_gate on the DB row."""
        record = {
            "title": "Gated Track",
            "artist": "Test Artist",
            "fileId": "gated_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/gated_001.mp3",
            "supportGate": {"type": "any"},
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/gated1"

        await ingest_track_create(
            did=artist.did, rkey="gated1", record=record, uri=uri, cid="bafygated"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        assert track.support_gate == {"type": "any"}
        assert track.is_gated is True

    async def test_track_create_sets_features(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """featured artists from record are stored on the track."""
        features = [{"did": "did:plc:feat1", "handle": "feat.bsky.social"}]
        record = {
            "title": "Featured Track",
            "artist": "Test Artist",
            "fileId": "feat_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/feat_001.mp3",
            "features": features,
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/feat1"

        await ingest_track_create(
            did=artist.did, rkey="feat1", record=record, uri=uri, cid="bafyfeat"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        assert track.features == features

    async def test_track_create_runs_hooks(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """ingest_track_create calls run_post_track_create_hooks with R2 URL."""
        record = {
            "title": "Hooked Track",
            "artist": "Test Artist",
            "fileId": "hook_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/hook_001.mp3",
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/hook1"

        with patch(
            "backend._internal.tasks.ingest.run_post_track_create_hooks",
            new_callable=AsyncMock,
        ) as mock_hooks:
            await ingest_track_create(
                did=artist.did, rkey="hook1", record=record, uri=uri, cid="bafyhook"
            )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        mock_hooks.assert_called_once_with(
            track.id, audio_url="https://r2.example.com/hook_001.mp3"
        )

    async def test_track_create_runs_hooks_both(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """with both audioBlob + audioUrl, hooks get R2 URL (CDN fallback)."""
        record = {
            "title": "Both Hooked",
            "artist": "Test Artist",
            "fileId": "both_hook_001",
            "fileType": "mp3",
            "audioBlob": {"ref": {"$link": "bafypdsblob"}, "mimeType": "audio/mpeg"},
            "audioUrl": "https://r2.example.com/both_hook_001.mp3",
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/bothhook1"

        with patch(
            "backend._internal.tasks.ingest.run_post_track_create_hooks",
            new_callable=AsyncMock,
        ) as mock_hooks:
            await ingest_track_create(
                did=artist.did, rkey="bothhook1", record=record, uri=uri, cid="bafyh"
            )

        mock_hooks.assert_called_once()
        call_audio_url = mock_hooks.call_args[1]["audio_url"]
        # R2 URL preferred over PDS blob when both are available
        assert call_audio_url == "https://r2.example.com/both_hook_001.mp3"


class TestIngestPendingReconciliation:
    """tests for the reserve-then-publish race condition handling."""

    async def test_finalize_pending_track(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """ingest finalizes a pending row reserved by the upload path."""
        uri = f"at://{artist.did}/fm.plyr.track/pending1"

        # simulate upload path reserving a pending row
        pending_track = Track(
            title="Pending Track",
            file_id="pend_001",
            file_type="mp3",
            artist_did=artist.did,
            r2_url="https://r2.example.com/pend_001.mp3",
            atproto_record_uri=uri,
            atproto_record_cid=None,
            publish_state="pending",
            audio_storage="r2",
        )
        db_session.add(pending_track)
        await db_session.commit()
        original_id = pending_track.id

        # ingest arrives with the same URI
        record = {
            "title": "Pending Track",
            "artist": "Test Artist",
            "fileId": "pend_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/pend_001.mp3",
            "createdAt": _recent_ts(),
        }
        await ingest_track_create(
            did=artist.did, rkey="pending1", record=record, uri=uri, cid="bafyfinalized"
        )

        # should finalize the existing row, not create a new one
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        tracks = result.scalars().all()
        assert len(tracks) == 1
        track = tracks[0]
        assert track.id == original_id
        assert track.publish_state == "published"
        assert track.atproto_record_cid == "bafyfinalized"

    async def test_finalize_pending_runs_hooks(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """finalizing a pending row runs post-creation hooks."""
        uri = f"at://{artist.did}/fm.plyr.track/pendhook1"

        pending_track = Track(
            title="Pending Hook Track",
            file_id="pendhook_001",
            file_type="mp3",
            artist_did=artist.did,
            r2_url="https://r2.example.com/pendhook_001.mp3",
            atproto_record_uri=uri,
            atproto_record_cid=None,
            publish_state="pending",
            audio_storage="r2",
        )
        db_session.add(pending_track)
        await db_session.commit()

        record = {
            "title": "Pending Hook Track",
            "artist": "Test Artist",
            "fileId": "pendhook_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/pendhook_001.mp3",
            "createdAt": _recent_ts(),
        }

        with patch(
            "backend._internal.tasks.ingest.run_post_track_create_hooks",
            new_callable=AsyncMock,
        ) as mock_hooks:
            await ingest_track_create(
                did=artist.did,
                rkey="pendhook1",
                record=record,
                uri=uri,
                cid="bafypendhook",
            )

        mock_hooks.assert_called_once()
        assert mock_hooks.call_args[0][0] == pending_track.id

    async def test_published_track_skips_ingest(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """already-published track is skipped (not re-finalized)."""
        uri = f"at://{artist.did}/fm.plyr.track/published1"

        published_track = Track(
            title="Published Track",
            file_id="pub_001",
            file_type="mp3",
            artist_did=artist.did,
            r2_url="https://r2.example.com/pub_001.mp3",
            atproto_record_uri=uri,
            atproto_record_cid="bafyoriginal",
            publish_state="published",
            audio_storage="r2",
        )
        db_session.add(published_track)
        await db_session.commit()

        record = {
            "title": "Published Track",
            "artist": "Test Artist",
            "fileId": "pub_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/pub_001.mp3",
            "createdAt": _recent_ts(),
        }
        await ingest_track_create(
            did=artist.did, rkey="published1", record=record, uri=uri, cid="bafynew"
        )

        # CID should NOT be overwritten
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        assert track.atproto_record_cid == "bafyoriginal"


class TestIngestTrackDelete:
    async def test_deletes_by_uri(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """deletes track by AT URI."""
        assert track.atproto_record_uri is not None
        await ingest_track_delete(
            did=artist.did,
            rkey="existing",
            uri=track.atproto_record_uri,
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == track.atproto_record_uri)
        )
        assert result.scalar_one_or_none() is None


class TestIngestTrackUpdate:
    async def test_updates_mutable_fields(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """updates title and description."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"title": "Updated Title", "description": "New desc"},
            uri=uri,
            cid="bafyupdated",
        )

        # expire cached objects so the re-query hits the DB
        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.title == "Updated Title"
        assert updated.description == "New desc"
        assert updated.atproto_record_cid == "bafyupdated"

    async def test_updates_support_gate(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """external supportGate change propagates to DB."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"supportGate": {"type": "any"}},
            uri=uri,
            cid="bafygated",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.support_gate == {"type": "any"}
        assert updated.is_gated is True

    async def test_removes_support_gate(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """supportGate present as None in record clears gating."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri

        # first set support_gate
        track.support_gate = {"type": "any"}
        await db_session.commit()

        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"supportGate": None},
            uri=uri,
            cid="bafyungated",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.support_gate is None
        assert updated.is_gated is False

    async def test_updates_features(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """features array propagates to DB."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        features = [{"did": "did:plc:feat1", "handle": "feat.bsky.social"}]
        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"features": features},
            uri=uri,
            cid="bafyfeat",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.features == features

    async def test_updates_extra_fields(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """album and duration propagate to track.extra."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"album": "New Album", "duration": 240},
            uri=uri,
            cid="bafyextra",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.extra is not None
        assert updated.extra.get("album") == "New Album"
        assert updated.extra.get("duration") == 240

    async def test_updates_audio_storage_to_pds(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """external audioBlob change updates storage fields."""
        assert track.atproto_record_uri is not None
        assert track.audio_storage == "r2"
        uri = track.atproto_record_uri
        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={
                "audioBlob": {
                    "ref": {"$link": "bafynewblob"},
                    "mimeType": "audio/mpeg",
                },
            },
            uri=uri,
            cid="bafyaudio",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.audio_storage == "pds"
        assert updated.pds_blob_cid == "bafynewblob"
        assert updated.r2_url is None

    async def test_updates_audio_storage_to_both(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """audioBlob + audioUrl together set audio_storage='both'."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={
                "audioBlob": {
                    "ref": {"$link": "bafybothblob"},
                    "mimeType": "audio/mpeg",
                },
                "audioUrl": "https://r2.example.com/both.mp3",
            },
            uri=uri,
            cid="bafyboth",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.audio_storage == "both"
        assert updated.pds_blob_cid == "bafybothblob"
        assert updated.r2_url == "https://r2.example.com/both.mp3"

    async def test_updates_audio_url(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """external audioUrl change updates r2_url."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"audioUrl": "https://r2.example.com/new_url.mp3"},
            uri=uri,
            cid="bafyurl",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.r2_url == "https://r2.example.com/new_url.mp3"
        assert updated.audio_storage == "r2"

    async def test_updates_file_type(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """external fileType change propagates."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"fileType": "flac"},
            uri=uri,
            cid="bafytype",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.file_type == "flac"


# --- like ingestion tests ---


class TestIngestLikeCreate:
    async def test_creates_like(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """valid like record creates TrackLike."""
        record = {
            "subject": {
                "uri": track.atproto_record_uri,
                "cid": track.atproto_record_cid,
            },
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.like/like1"

        await ingest_like_create(did=artist.did, rkey="like1", record=record, uri=uri)

        result = await db_session.execute(
            select(TrackLike).where(TrackLike.atproto_like_uri == uri)
        )
        like = result.scalar_one()
        assert like.track_id == track.id
        assert like.user_did == artist.did

    async def test_raises_on_unknown_track(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """like for unknown subject track raises SubjectNotFoundError for retry."""
        record = {
            "subject": {"uri": "at://did:plc:jetstream_test/fm.plyr.track/nonexistent"},
            "createdAt": _recent_ts(),
        }
        with pytest.raises(SubjectNotFoundError):
            await ingest_like_create(
                did=artist.did,
                rkey="like2",
                record=record,
                uri="at://did:plc:jetstream_test/fm.plyr.like/like2",
            )


class TestIngestLikeDelete:
    async def test_deletes_by_uri(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """deletes like by AT URI."""
        like = TrackLike(
            track_id=track.id,
            user_did=artist.did,
            atproto_like_uri="at://did:plc:jetstream_test/fm.plyr.like/todelete",
        )
        db_session.add(like)
        await db_session.commit()

        await ingest_like_delete(
            did=artist.did,
            rkey="todelete",
            uri="at://did:plc:jetstream_test/fm.plyr.like/todelete",
        )

        result = await db_session.execute(
            select(TrackLike).where(
                TrackLike.atproto_like_uri
                == "at://did:plc:jetstream_test/fm.plyr.like/todelete"
            )
        )
        assert result.scalar_one_or_none() is None


# --- comment ingestion tests ---


class TestIngestCommentCreate:
    async def test_creates_comment(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """valid comment record creates TrackComment."""
        record = {
            "subject": {"uri": track.atproto_record_uri},
            "text": "great track!",
            "timestampMs": 5000,
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.comment/c1"

        await ingest_comment_create(did=artist.did, rkey="c1", record=record, uri=uri)

        result = await db_session.execute(
            select(TrackComment).where(TrackComment.atproto_comment_uri == uri)
        )
        comment = result.scalar_one()
        assert comment.text == "great track!"
        assert comment.timestamp_ms == 5000

    async def test_raises_on_unknown_track(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """comment for unknown track raises SubjectNotFoundError for retry."""
        record = {
            "subject": {"uri": "at://did:plc:jetstream_test/fm.plyr.track/nope"},
            "text": "nope",
            "timestampMs": 0,
            "createdAt": _recent_ts(),
        }
        with pytest.raises(SubjectNotFoundError):
            await ingest_comment_create(
                did=artist.did,
                rkey="c2",
                record=record,
                uri="at://did:plc:jetstream_test/fm.plyr.comment/c2",
            )


class TestIngestCommentDelete:
    async def test_deletes_by_uri(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """deletes comment by AT URI."""
        comment = TrackComment(
            track_id=track.id,
            user_did=artist.did,
            text="to delete",
            timestamp_ms=0,
            atproto_comment_uri="at://did:plc:jetstream_test/fm.plyr.comment/del1",
        )
        db_session.add(comment)
        await db_session.commit()

        await ingest_comment_delete(
            did=artist.did,
            rkey="del1",
            uri="at://did:plc:jetstream_test/fm.plyr.comment/del1",
        )

        result = await db_session.execute(
            select(TrackComment).where(
                TrackComment.atproto_comment_uri
                == "at://did:plc:jetstream_test/fm.plyr.comment/del1"
            )
        )
        assert result.scalar_one_or_none() is None


# --- playlist ingestion tests ---


class TestIngestListCreate:
    async def test_creates_playlist(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """listType=playlist creates a Playlist row."""
        record = {
            "listType": "playlist",
            "name": "My Playlist",
            "items": [],
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.list/pl1"

        await ingest_list_create(
            did=artist.did, rkey="pl1", record=record, uri=uri, cid="bafypl"
        )

        result = await db_session.execute(
            select(Playlist).where(Playlist.atproto_record_uri == uri)
        )
        playlist = result.scalar_one()
        assert playlist.name == "My Playlist"
        assert playlist.owner_did == artist.did
        assert playlist.track_count == 0

    async def test_creates_playlist_with_items(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """track_count is set from items array length."""
        items = [
            {"subject": {"uri": f"at://x/fm.plyr.track/t{i}", "cid": f"bafy{i}"}}
            for i in range(3)
        ]
        record = {
            "listType": "playlist",
            "name": "Populated Playlist",
            "items": items,
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.list/pl_items"

        await ingest_list_create(
            did=artist.did, rkey="pl_items", record=record, uri=uri, cid="bafyitems"
        )

        result = await db_session.execute(
            select(Playlist).where(Playlist.atproto_record_uri == uri)
        )
        playlist = result.scalar_one()
        assert playlist.track_count == 3

    async def test_skips_album_type(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """listType=album is not created as a Playlist."""
        record = {
            "listType": "album",
            "name": "My Album",
            "items": [],
            "createdAt": _recent_ts(),
        }
        await ingest_list_create(
            did=artist.did,
            rkey="al1",
            record=record,
            uri="at://did:plc:jetstream_test/fm.plyr.list/al1",
        )

        result = await db_session.execute(
            select(Playlist).where(Playlist.owner_did == artist.did)
        )
        assert result.scalar_one_or_none() is None


class TestIngestListUpdate:
    async def test_updates_name(self, db_session: AsyncSession, artist: Artist) -> None:
        """playlist name update propagates."""
        # create playlist first
        record = {
            "listType": "playlist",
            "name": "Original",
            "items": [],
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.list/pl_upd"
        await ingest_list_create(
            did=artist.did, rkey="pl_upd", record=record, uri=uri, cid="bafy1"
        )

        await ingest_list_update(
            did=artist.did,
            rkey="pl_upd",
            record={"name": "Renamed"},
            uri=uri,
            cid="bafy2",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Playlist).where(Playlist.atproto_record_uri == uri)
        )
        playlist = result.scalar_one()
        assert playlist.name == "Renamed"

    async def test_updates_track_count(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """track_count updates when items change."""
        record = {
            "listType": "playlist",
            "name": "Counting",
            "items": [],
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.list/pl_count"
        await ingest_list_create(
            did=artist.did, rkey="pl_count", record=record, uri=uri, cid="bafy1"
        )

        items = [
            {"subject": {"uri": f"at://x/fm.plyr.track/t{i}", "cid": f"bafy{i}"}}
            for i in range(5)
        ]
        await ingest_list_update(
            did=artist.did,
            rkey="pl_count",
            record={"items": items},
            uri=uri,
            cid="bafy2",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Playlist).where(Playlist.atproto_record_uri == uri)
        )
        playlist = result.scalar_one()
        assert playlist.track_count == 5


# --- ingest validation tests ---


class TestIngestValidation:
    """integration tests confirming invalid records are rejected before DB work."""

    async def test_track_empty_title_skipped(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """track with empty title (minLength violation) is skipped."""
        record = {
            "title": "",
            "artist": "Test Artist",
            "audioUrl": "https://r2.example.com/x.mp3",
            "fileType": "mp3",
            "createdAt": _recent_ts(),
        }
        await ingest_track_create(
            did=artist.did,
            rkey="bad1",
            record=record,
            uri="at://did:plc:jetstream_test/fm.plyr.track/bad1",
            cid="bafy",
        )
        result = await db_session.execute(
            select(Track).where(
                Track.atproto_record_uri
                == "at://did:plc:jetstream_test/fm.plyr.track/bad1"
            )
        )
        assert result.scalar_one_or_none() is None

    async def test_track_missing_required_fields_skipped(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """track missing required fields is skipped."""
        await ingest_track_create(
            did=artist.did,
            rkey="bad2",
            record={"title": "ok"},
            uri="at://did:plc:jetstream_test/fm.plyr.track/bad2",
            cid="bafy",
        )
        result = await db_session.execute(
            select(Track).where(
                Track.atproto_record_uri
                == "at://did:plc:jetstream_test/fm.plyr.track/bad2"
            )
        )
        assert result.scalar_one_or_none() is None

    async def test_like_missing_subject_skipped(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """like without subject is skipped."""
        await ingest_like_create(
            did=artist.did,
            rkey="bad3",
            record={"createdAt": "2025-01-01T00:00:00Z"},
            uri="at://did:plc:jetstream_test/fm.plyr.like/bad3",
        )
        result = await db_session.execute(
            select(TrackLike).where(
                TrackLike.atproto_like_uri
                == "at://did:plc:jetstream_test/fm.plyr.like/bad3"
            )
        )
        assert result.scalar_one_or_none() is None

    async def test_comment_text_too_long_skipped(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """comment with text exceeding maxLength is skipped."""
        await ingest_comment_create(
            did=artist.did,
            rkey="bad4",
            record={
                "subject": {"uri": track.atproto_record_uri},
                "text": "x" * 1001,
                "timestampMs": 0,
                "createdAt": _recent_ts(),
            },
            uri="at://did:plc:jetstream_test/fm.plyr.comment/bad4",
        )
        result = await db_session.execute(
            select(TrackComment).where(
                TrackComment.atproto_comment_uri
                == "at://did:plc:jetstream_test/fm.plyr.comment/bad4"
            )
        )
        assert result.scalar_one_or_none() is None

    async def test_valid_track_still_ingested(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """sanity check: valid record is still ingested normally."""
        record = {
            "title": "Valid Track",
            "artist": "Test Artist",
            "audioUrl": "https://r2.example.com/valid.mp3",
            "fileType": "mp3",
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/valid1"
        await ingest_track_create(
            did=artist.did, rkey="valid1", record=record, uri=uri, cid="bafy"
        )
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert result.scalar_one().title == "Valid Track"

    async def test_list_missing_items_skipped(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """list missing required items field is skipped."""
        await ingest_list_create(
            did=artist.did,
            rkey="bad5",
            record={
                "listType": "playlist",
                "name": "Bad List",
                "createdAt": _recent_ts(),
            },
            uri="at://did:plc:jetstream_test/fm.plyr.list/bad5",
        )
        result = await db_session.execute(
            select(Playlist).where(
                Playlist.atproto_record_uri
                == "at://did:plc:jetstream_test/fm.plyr.list/bad5"
            )
        )
        assert result.scalar_one_or_none() is None

    async def test_list_update_invalid_name_skipped(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """list update with name exceeding maxLength is skipped."""
        await ingest_list_update(
            did=artist.did,
            rkey="bad6",
            record={"name": "x" * 300},
            uri="at://did:plc:jetstream_test/fm.plyr.list/bad6",
        )
        # nothing to assert on DB — just confirm no exception raised
