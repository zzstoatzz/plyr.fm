"""tests for Jetstream consumer and ingest tasks."""

import time
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.atproto.account_status import hides_content
from backend._internal.atproto.profile import avatar_url_from_profile_record
from backend._internal.jetstream import BSKY_PROFILE_COLLECTION, JetstreamConsumer
from backend._internal.tasks.ingest import (
    SubjectNotFoundError,
    _write_tombstone,
    ingest_account_reactivated,
    ingest_account_status_change,
    ingest_bsky_profile_update,
    ingest_comment_create,
    ingest_comment_delete,
    ingest_identity_update,
    ingest_like_create,
    ingest_like_delete,
    ingest_list_create,
    ingest_list_update,
    ingest_profile_update,
    ingest_track_create,
    ingest_track_delete,
    ingest_track_update,
)
from backend.config import settings
from backend.models import Artist, Playlist, Track, TrackComment, TrackLike
from backend.models.session import UserSession


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


@pytest.fixture(autouse=True)
def _mock_trusted_origins():
    """bypass origin trust checks — tested separately in test_origin_trust.py."""
    with (
        patch(
            "backend._internal.tasks.ingest.is_trusted_audio_origin", return_value=True
        ),
        patch(
            "backend._internal.tasks.ingest.is_trusted_image_origin", return_value=True
        ),
    ):
        yield


@pytest.fixture(autouse=True)
def _mock_audio_object_exists():
    """default: a trusted audioUrl is backed by a real R2 object.

    the unbacked case (the natespilman 1153/1154 bug) is exercised explicitly
    by the regression tests below, which override this to False.
    """
    with patch(
        "backend._internal.tasks.ingest._audio_object_exists", return_value=True
    ) as m:
        yield m


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

    async def test_own_collection_commit_from_unknown_did_refreshes_dids(self) -> None:
        """a new account's first records land seconds after its artist row
        and inside the refresh interval; that like used to be dropped."""
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:known"}
        consumer._last_did_refresh = 0.0

        async def refresh() -> None:
            consumer._known_dids.add("did:plc:new")
            consumer._last_did_refresh = time.monotonic()

        consumer._refresh_known_dids = refresh  # type: ignore[method-assign]
        consumer._dispatch = AsyncMock()  # type: ignore[method-assign]
        await consumer._process_event(
            {
                "kind": "commit",
                "did": "did:plc:new",
                "time_us": 1,
                "commit": {
                    "collection": settings.atproto.like_collection,
                    "operation": "create",
                    "rkey": "abc",
                    "record": {},
                },
            }
        )
        consumer._dispatch.assert_called_once()  # type: ignore[union-attr]
        assert consumer._dispatch.call_args.kwargs["did"] == "did:plc:new"  # type: ignore[union-attr]

    async def test_unknown_did_refresh_is_rate_limited(self) -> None:
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:known"}
        consumer._last_did_refresh = time.monotonic()
        consumer._refresh_known_dids = AsyncMock()  # type: ignore[method-assign]
        consumer._dispatch = AsyncMock()  # type: ignore[method-assign]
        await consumer._process_event(
            {
                "kind": "commit",
                "did": "did:plc:new",
                "commit": {
                    "collection": settings.atproto.like_collection,
                    "operation": "create",
                    "rkey": "abc",
                },
            }
        )
        consumer._refresh_known_dids.assert_not_called()  # type: ignore[union-attr]
        consumer._dispatch.assert_not_called()  # type: ignore[union-attr]

    async def test_bsky_commit_from_unknown_did_does_not_refresh(self) -> None:
        """~2 profile commits a second network-wide must not hit the database."""
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:known"}
        consumer._last_did_refresh = 0.0
        consumer._refresh_known_dids = AsyncMock()  # type: ignore[method-assign]
        await consumer._process_event(
            {
                "kind": "commit",
                "did": "did:plc:stranger",
                "commit": {
                    "collection": BSKY_PROFILE_COLLECTION,
                    "operation": "update",
                    "rkey": "self",
                },
            }
        )
        consumer._refresh_known_dids.assert_not_called()  # type: ignore[union-attr]

    async def test_dispatches_profile_create(self) -> None:
        """sign-up writes the profile record; it must echo like any other write."""
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:jetstream_test"}
        dispatched: list[object] = []
        mock_docket = MagicMock()

        def add(task: object) -> object:
            dispatched.append(task)

            async def call(**kwargs: object) -> None:
                pass

            return call

        mock_docket.add = add
        event = {
            "kind": "commit",
            "did": "did:plc:jetstream_test",
            "time_us": 1,
            "commit": {
                "collection": settings.atproto.profile_collection,
                "operation": "create",
                "rkey": "self",
                "record": {"bio": "hi"},
            },
        }
        with patch("backend._internal.jetstream.get_docket", return_value=mock_docket):
            await consumer._process_event(event)
        assert dispatched == [ingest_profile_update]

    async def test_skips_non_commit_non_identity_non_account_events(self) -> None:
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:jetstream_test"}
        consumer._dispatch = AsyncMock()  # type: ignore[method-assign]

        event = {"kind": "info", "did": "did:plc:jetstream_test"}
        await consumer._process_event(event)
        consumer._dispatch.assert_not_called()  # type: ignore[union-attr]

    async def test_dispatches_account_event(self) -> None:
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:jetstream_test"}

        mock_docket = MagicMock()
        dispatched: list[dict] = []

        async def capture(**kwargs: object) -> None:
            dispatched.append(dict(kwargs))

        mock_docket.add = MagicMock(return_value=capture)

        event = {
            "kind": "account",
            "did": "did:plc:jetstream_test",
            "time_us": 3000000,
            "account": {"active": True, "status": "active"},
        }

        with patch("backend._internal.jetstream.get_docket", return_value=mock_docket):
            await consumer._process_event(event)

        assert len(dispatched) == 1
        assert dispatched[0]["did"] == "did:plc:jetstream_test"
        assert dispatched[0]["active"] is True
        assert consumer._cursor == 3000000

    async def test_account_event_skips_unknown_did(self) -> None:
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:known"}

        mock_docket = MagicMock()
        mock_docket.add = MagicMock()

        event = {
            "kind": "account",
            "did": "did:plc:unknown",
            "account": {"active": False, "status": "deactivated"},
        }

        with patch("backend._internal.jetstream.get_docket", return_value=mock_docket):
            await consumer._process_event(event)

        mock_docket.add.assert_not_called()

    async def test_dispatches_identity_event(self) -> None:
        """a real (handle-less) identity event dispatches on DID alone.

        regression for the bug where dispatch was gated on `identity.handle`:
        jetstream `#identity` events carry only `{did, seq, time}` — no handle —
        so the gate was always false and `ingest_identity_update` never ran.
        the shape below matches a live jetstream payload.
        """
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:jetstream_test"}

        mock_docket = MagicMock()
        dispatched: list[dict] = []

        async def capture(**kwargs: object) -> None:
            dispatched.append(dict(kwargs))

        mock_docket.add = MagicMock(return_value=capture)

        event = {
            "kind": "identity",
            "did": "did:plc:jetstream_test",
            "time_us": 2000000,
            "identity": {"seq": 31115825625, "time": "2026-06-20T18:11:39.496Z"},
        }

        with patch("backend._internal.jetstream.get_docket", return_value=mock_docket):
            await consumer._process_event(event)

        assert len(dispatched) == 1
        assert dispatched[0] == {"did": "did:plc:jetstream_test"}
        assert consumer._cursor == 2000000

    async def test_identity_event_skips_unknown_did(self) -> None:
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:known"}

        mock_docket = MagicMock()
        mock_docket.add = MagicMock()

        event = {
            "kind": "identity",
            "did": "did:plc:unknown",
            "identity": {"seq": 1, "time": "2026-06-20T18:11:39.496Z"},
        }

        with patch("backend._internal.jetstream.get_docket", return_value=mock_docket):
            await consumer._process_event(event)

        mock_docket.add.assert_not_called()

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
        consumer = JetstreamConsumer(collections=["fm.plyr.track", "fm.plyr.like"])
        url = consumer._build_url()
        assert "wantedCollections=fm.plyr.track" in url
        assert "wantedCollections=fm.plyr.like" in url
        assert "cursor=" not in url

    async def test_build_url_with_cursor_rewinds(self) -> None:
        consumer = JetstreamConsumer()
        consumer._cursor = 10_000_000  # 10 seconds in microseconds
        url = consumer._build_url()
        # rewound by 5_000_000 → cursor=5000000
        assert "cursor=5000000" in url

    async def test_default_collections_from_settings(self) -> None:
        """collections derive from settings.atproto.app_namespace."""
        with patch("backend._internal.jetstream.settings") as mock_settings:
            mock_settings.atproto.track_collection = "fm.plyr.stg.track"
            mock_settings.atproto.like_collection = "fm.plyr.stg.like"
            mock_settings.atproto.comment_collection = "fm.plyr.stg.comment"
            mock_settings.atproto.list_collection = "fm.plyr.stg.list"
            mock_settings.atproto.profile_collection = "fm.plyr.stg.actor.profile"
            consumer = JetstreamConsumer()
        assert consumer._collections == [
            "fm.plyr.stg.track",
            "fm.plyr.stg.like",
            "fm.plyr.stg.comment",
            "fm.plyr.stg.list",
            "fm.plyr.stg.actor.profile",
            # not namespaced: bluesky profiles are the same in every environment
            "app.bsky.actor.profile",
        ]

    async def test_explicit_collections_override(self) -> None:
        """passing collections explicitly bypasses settings."""
        consumer = JetstreamConsumer(collections=["fm.plyr.dev.track"])
        assert consumer._collections == ["fm.plyr.dev.track"]


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
            "labels": {
                "$type": "com.atproto.label.defs#selfLabels",
                "values": [{"val": "sexual"}],
            },
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
        assert track.self_labels == ["sexual"]

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

    async def test_unbacked_audio_url_falls_back_to_blob(
        self,
        db_session: AsyncSession,
        artist: Artist,
        _mock_audio_object_exists: MagicMock,
    ) -> None:
        """audioUrl with no backing R2 object is dropped; the track serves from
        its PDS blob instead of persisting an r2_url that 404s forever.

        regression for natespilman 1153/1154: a firehose record claimed a
        plyr-CDN audioUrl for an object plyr never stored. without the existence
        check this lands as audio_storage='both' with a dead r2_url.
        """
        _mock_audio_object_exists.return_value = False
        record = {
            "title": "Unbacked Both Track",
            "artist": "Test Artist",
            "fileId": "unbacked_001",
            "fileType": "mp3",
            "audioBlob": {"ref": {"$link": "bafyrealblob"}, "mimeType": "audio/mpeg"},
            "audioUrl": "https://r2.example.com/unbacked_001.mp3",
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/unbacked1"

        await ingest_track_create(
            did=artist.did, rkey="unbacked1", record=record, uri=uri, cid="bafynew"
        )

        track = (
            await db_session.execute(
                select(Track).where(Track.atproto_record_uri == uri)
            )
        ).scalar_one()
        assert track.audio_storage == "pds"
        assert track.r2_url is None
        assert track.pds_blob_cid == "bafyrealblob"

    async def test_unbacked_audio_url_no_blob_skipped(
        self,
        db_session: AsyncSession,
        artist: Artist,
        _mock_audio_object_exists: MagicMock,
    ) -> None:
        """audioUrl with no backing R2 object and no blob is rejected — there is
        nothing playable to ingest."""
        _mock_audio_object_exists.return_value = False
        record = {
            "title": "Unbacked No Blob",
            "artist": "Test Artist",
            "fileId": "unbacked_002",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/unbacked_002.mp3",
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/unbacked2"

        await ingest_track_create(
            did=artist.did, rkey="unbacked2", record=record, uri=uri, cid="bafynew"
        )

        assert (
            await db_session.execute(
                select(Track).where(Track.atproto_record_uri == uri)
            )
        ).scalar_one_or_none() is None

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
        assert track.audio_storage == "pds"
        assert track.pds_blob_cid == "bafypdsonly"
        assert track.r2_url is None

    async def test_neither_audio_field_skipped(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """record with neither audioUrl nor audioBlob is rejected."""
        record = {
            "title": "No Audio",
            "artist": "Test Artist",
            "fileId": "noaudio_001",
            "fileType": "mp3",
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/noaudio1"

        await ingest_track_create(
            did=artist.did, rkey="noaudio1", record=record, uri=uri, cid="bafyno"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert result.scalar_one_or_none() is None

    async def test_future_timestamp_skipped(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """record with createdAt in the future is rejected."""
        record = {
            "title": "Future Track",
            "artist": "Test Artist",
            "fileId": "future_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/future_001.mp3",
            "createdAt": "2099-01-01T00:00:00Z",
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/future1"

        await ingest_track_create(
            did=artist.did, rkey="future1", record=record, uri=uri, cid="bafyfuture"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert result.scalar_one_or_none() is None

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
        """ingest stores ONLY the featured artists' DIDs.

        per the canonical-DID redesign (#1355) the lexicon's denormalized
        `handle`/`displayName` snapshot is intentionally discarded — those
        fields drift over time and are hydrated fresh at API-read time
        from the artist's profile via `_internal.atproto.profiles`.
        """
        record_features = [
            {
                "did": "did:plc:feat1",
                "handle": "feat.bsky.social",
                "displayName": "Featured One",
            }
        ]
        record = {
            "title": "Featured Track",
            "artist": "Test Artist",
            "fileId": "feat_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/feat_001.mp3",
            "features": record_features,
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
        assert track.features == [{"did": "did:plc:feat1"}]

    async def test_track_create_defaults_features_to_empty_list(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """tracks without features field get [] not None (prevents TrackResponse crash)."""
        record = {
            "title": "No Features Track",
            "artist": "Test Artist",
            "fileId": "nofeat_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/nofeat_001.mp3",
            "createdAt": _recent_ts(),
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/nofeat1"

        await ingest_track_create(
            did=artist.did, rkey="nofeat1", record=record, uri=uri, cid="bafynofeat"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        assert track.features == []

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
            track.id,
            audio_url="https://r2.example.com/hook_001.mp3",
            skip_notification=False,
            skip_copyright=False,
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

        # ingest commits in its own db_session — expire cached state
        db_session.expire_all()

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

        db_session.expire_all()

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

    async def test_deadlock_does_not_raise(self, artist: Artist) -> None:
        """deadlock from concurrent API + Jetstream delete is swallowed."""
        from sqlalchemy.exc import OperationalError

        with patch(
            "backend._internal.tasks.ingest.db_session",
        ) as mock_ctx:
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock(
                side_effect=OperationalError(
                    "deadlock", {}, Exception("deadlock detected")
                )
            )
            mock_ctx.return_value.__aenter__ = AsyncMock(return_value=mock_db)
            mock_ctx.return_value.__aexit__ = AsyncMock(return_value=False)

            # should not raise
            await ingest_track_delete(
                did=artist.did,
                rkey="rkey",
                uri="at://did:plc:test/fm.plyr.track/deadlocked",
            )


class TestIngestTrackUpdate:
    async def test_replaces_creator_self_labels_from_full_record(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """A PDS putRecord replaces the indexed creator assertion."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        track.self_labels = ["sexual"]
        await db_session.commit()

        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={
                "title": track.title,
                "labels": {
                    "$type": "com.atproto.label.defs#selfLabels",
                    "values": [{"val": "porn"}],
                },
            },
            uri=uri,
            cid="bafyselflabels",
        )

        db_session.expire_all()
        updated = await db_session.scalar(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert updated is not None
        assert updated.self_labels == ["porn"]

    async def test_absent_creator_self_labels_clears_indexed_assertion(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """The full replacement record is authoritative when labels are removed."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        track.self_labels = ["sexual"]
        await db_session.commit()

        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"title": track.title},
            uri=uri,
            cid="bafyclearedlabels",
        )

        db_session.expire_all()
        updated = await db_session.scalar(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert updated is not None
        assert updated.self_labels == []

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
        """ingest_track_update stores ONLY the DIDs from updated features.

        regression coverage for #1355 — the round-trip via PDS used to
        overwrite snake_case DB rows with the lexicon's camelCase shape;
        now we just keep the DID and resolve fresh at read time.
        """
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        record_features = [
            {
                "did": "did:plc:feat1",
                "handle": "feat.bsky.social",
                "displayName": "Featured One",
            }
        ]
        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"features": record_features},
            uri=uri,
            cid="bafyfeat",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.features == [{"did": "did:plc:feat1"}]

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

    async def test_skips_create_for_cancelled_uri(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """regression for the like-resurrection race surfaced by
        `test_cross_user_like` in the staging integration suite.

        sequence: user clicks like (DB INSERT, atproto_like_uri=NULL),
        then unlikes before `pds_create_like` finishes writing to PDS
        (DB row deleted, no PDS URI to schedule a delete for). then
        `pds_create_like` completes — PDS record IS written, but the
        local row is gone, so it tombstones the URI and schedules an
        orphan PDS delete. before that delete propagates through
        Jetstream, the matching `app.bsky.feed.like` create event
        arrives. without the tombstone check this re-inserts the row
        the user already cancelled; with it, the event is dropped.
        """
        from backend._internal.tasks.pds import LIKE_CANCELLED_TOMBSTONE_PREFIX

        cancelled_uri = "at://did:plc:jetstream_test/fm.plyr.like/cancelled"
        store: dict[str, str] = {
            f"{LIKE_CANCELLED_TOMBSTONE_PREFIX}{cancelled_uri}": "1"
        }

        async def fake_exists(key: str) -> int:
            return 1 if key in store else 0

        mock_redis = AsyncMock()
        mock_redis.exists = AsyncMock(side_effect=fake_exists)

        record = {
            "subject": {
                "uri": track.atproto_record_uri,
                "cid": track.atproto_record_cid,
            },
            "createdAt": _recent_ts(),
        }
        with patch(
            "backend._internal.tasks.pds.get_async_redis_client",
            return_value=mock_redis,
        ):
            await ingest_like_create(
                did=artist.did,
                rkey="cancelled",
                record=record,
                uri=cancelled_uri,
            )

        result = await db_session.execute(
            select(TrackLike).where(TrackLike.atproto_like_uri == cancelled_uri)
        )
        assert result.scalar_one_or_none() is None, (
            "ingest_like_create must drop the create event when the URI is "
            "tombstoned by pds_create_like's orphan-cleanup path; otherwise "
            "the unlike-while-pending race resurrects the row."
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


# --- ghost track prevention tests ---


class TestGhostTrackPrevention:
    """tombstone mechanism prevents ghost tracks from Jetstream cursor rewind."""

    def _mock_redis(self) -> tuple[AsyncMock, dict[str, str]]:
        """return a mock redis client backed by an in-memory dict."""
        store: dict[str, str] = {}
        mock = AsyncMock()

        async def _set(key: str, value: str, ex: int | None = None) -> None:
            store[key] = value

        async def _exists(key: str) -> int:
            return 1 if key in store else 0

        mock.set = AsyncMock(side_effect=_set)
        mock.exists = AsyncMock(side_effect=_exists)
        return mock, store

    async def test_delete_then_create_skips_ghost(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """replayed create after delete is skipped via tombstone."""
        uri = f"at://{artist.did}/fm.plyr.track/ghost1"
        mock_redis, _store = self._mock_redis()

        with patch(
            "backend._internal.tasks.ingest.get_async_redis_client",
            return_value=mock_redis,
        ):
            # delete fires tombstone even when row doesn't exist (exact replay scenario)
            await ingest_track_delete(did=artist.did, rkey="ghost1", uri=uri)

            # replayed create should be skipped
            record = {
                "title": "Ghost Track",
                "artist": "Test",
                "audioUrl": "https://r2.example.com/ghost.mp3",
                "fileType": "mp3",
                "createdAt": _recent_ts(),
            }
            await ingest_track_create(
                did=artist.did, rkey="ghost1", record=record, uri=uri, cid="bafyghost"
            )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert result.scalar_one_or_none() is None

    async def test_tombstone_does_not_block_different_uri(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """tombstone for URI A does not block creation of URI B."""
        uri_a = f"at://{artist.did}/fm.plyr.track/deleted1"
        uri_b = f"at://{artist.did}/fm.plyr.track/new1"
        mock_redis, _store = self._mock_redis()

        with patch(
            "backend._internal.tasks.ingest.get_async_redis_client",
            return_value=mock_redis,
        ):
            await _write_tombstone(uri_a)

            record = {
                "title": "New Track",
                "artist": "Test",
                "audioUrl": "https://r2.example.com/new.mp3",
                "fileType": "mp3",
                "createdAt": _recent_ts(),
            }
            await ingest_track_create(
                did=artist.did, rkey="new1", record=record, uri=uri_b, cid="bafynew"
            )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri_b)
        )
        assert result.scalar_one() is not None

    async def test_redis_down_allows_create(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """when Redis is unavailable, create proceeds (fail-open)."""
        uri = f"at://{artist.did}/fm.plyr.track/failopen1"
        mock_redis = AsyncMock()
        mock_redis.exists = AsyncMock(side_effect=ConnectionError("redis down"))
        mock_redis.set = AsyncMock(side_effect=ConnectionError("redis down"))

        with patch(
            "backend._internal.tasks.ingest.get_async_redis_client",
            return_value=mock_redis,
        ):
            record = {
                "title": "Fail Open Track",
                "artist": "Test",
                "audioUrl": "https://r2.example.com/failopen.mp3",
                "fileType": "mp3",
                "createdAt": _recent_ts(),
            }
            await ingest_track_create(
                did=artist.did,
                rkey="failopen1",
                record=record,
                uri=uri,
                cid="bafyfailopen",
            )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert result.scalar_one() is not None


# --- identity update tests ---


def _patch_identity_update(
    *,
    handle: str | None = None,
    pds: str = "https://pds.example.com",
    avatar_url: str | None = None,
    mini_doc_none: bool = False,
):
    """context manager stack for patching slingshot resolution + avatar fetch.

    by default the resolved miniDoc keeps the artist's current handle (caller
    overrides `handle` to simulate a change). `mini_doc_none=True` simulates a
    slingshot failure (the safe resolver returns None).
    """
    from contextlib import ExitStack

    from backend._internal.slingshot import MiniDoc

    stack = ExitStack()
    mini_doc = (
        None
        if mini_doc_none
        else MiniDoc(
            did="did:plc:ignored",
            handle=handle or "",
            pds=pds,
            signing_key="zkey",
        )
    )
    stack.enter_context(
        patch(
            "backend._internal.slingshot.resolve_mini_doc_safe",
            new_callable=AsyncMock,
            return_value=mini_doc,
        )
    )
    stack.enter_context(
        patch(
            "backend._internal.atproto.profile.fetch_user_avatar",
            new_callable=AsyncMock,
            return_value=avatar_url,
        )
    )
    return stack


class TestIngestIdentityUpdate:
    async def test_updates_artist_handle(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        new_handle = "updated.handle.example"
        with _patch_identity_update(handle=new_handle):
            await ingest_identity_update(did=artist.did)

        await db_session.refresh(artist)
        assert artist.handle == new_handle

    async def test_updates_session_handles(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        session = UserSession(
            session_id=f"sess_{uuid.uuid4().hex[:12]}",
            did=artist.did,
            handle=artist.handle,
            oauth_session_data="{}",
        )
        db_session.add(session)
        await db_session.commit()

        new_handle = "updated.handle.example"
        with _patch_identity_update(handle=new_handle):
            await ingest_identity_update(did=artist.did)

        await db_session.refresh(session)
        assert session.handle == new_handle

    async def test_updates_pds_url(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """PDS migration updates the cached pds_url via slingshot resolution."""
        new_pds = "https://new-pds.example.com"
        with _patch_identity_update(handle=artist.handle, pds=new_pds):
            await ingest_identity_update(did=artist.did)

        await db_session.refresh(artist)
        assert artist.pds_url == new_pds

    async def test_updates_avatar(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """identity event refreshes avatar from Bluesky profile."""
        new_avatar = "https://cdn.bsky.app/img/avatar/plain/did:plc:test/newcid@jpeg"
        with _patch_identity_update(handle=artist.handle, avatar_url=new_avatar):
            await ingest_identity_update(did=artist.did)

        await db_session.refresh(artist)
        assert artist.avatar_url == new_avatar

    async def test_noop_when_handle_pds_and_avatar_unchanged(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """no commit when nothing changed — idempotent."""
        original_handle = artist.handle
        original_pds = artist.pds_url
        original_avatar = artist.avatar_url
        with _patch_identity_update(
            handle=original_handle,
            pds=original_pds or "",
            avatar_url=original_avatar,
        ):
            await ingest_identity_update(did=artist.did)

        await db_session.refresh(artist)
        assert artist.handle == original_handle
        assert artist.pds_url == original_pds
        assert artist.avatar_url == original_avatar

    async def test_noop_for_unknown_did(self, db_session: AsyncSession) -> None:
        """unknown DID is silently skipped (no resolution attempted)."""
        await ingest_identity_update(did="did:plc:nonexistent")

    async def test_resolution_failure_still_refreshes_avatar(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """if slingshot resolution fails, handle/PDS are left alone but the
        avatar still refreshes — a partial failure doesn't block the rest."""
        new_avatar = "https://cdn.bsky.app/img/avatar/plain/did:plc:test/fresh@jpeg"
        original_handle = artist.handle
        with _patch_identity_update(mini_doc_none=True, avatar_url=new_avatar):
            await ingest_identity_update(did=artist.did)

        await db_session.refresh(artist)
        assert artist.handle == original_handle
        assert artist.avatar_url == new_avatar


class TestIngestAccountStatusChange:
    async def test_reactivation_restores_avatar(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """reactivation fetches fresh avatar from Bluesky."""
        artist.avatar_url = None
        await db_session.commit()

        new_avatar = "https://cdn.bsky.app/img/avatar/plain/did:plc:test/cid123@jpeg"
        with patch(
            "backend._internal.atproto.profile.fetch_user_avatar",
            new_callable=AsyncMock,
            return_value=new_avatar,
        ):
            await ingest_account_status_change(did=artist.did, active=True)

        await db_session.refresh(artist)
        assert artist.avatar_url == new_avatar

    async def test_deactivation_clears_avatar(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """deactivation clears avatar to avoid broken CDN URLs.

        `status` is now required to reach this path — an inactive event with no
        reason given no longer touches the artist at all (see
        TestAccountStatusSemantics). every `active=false` observed in production
        carried `status="deactivated"`.
        """
        artist.avatar_url = (
            "https://cdn.bsky.app/img/avatar/plain/did:plc:test/old@jpeg"
        )
        await db_session.commit()

        await ingest_account_status_change(
            did=artist.did, active=False, status="deactivated"
        )

        await db_session.refresh(artist)
        assert artist.avatar_url is None

    async def test_deactivation_noop_when_no_avatar(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """deactivation is a noop if avatar is already None."""
        artist.avatar_url = None
        await db_session.commit()

        await ingest_account_status_change(did=artist.did, active=False)

        await db_session.refresh(artist)
        assert artist.avatar_url is None

    async def test_unknown_did_is_skipped(self, db_session: AsyncSession) -> None:
        """unknown DID is silently skipped."""
        await ingest_account_status_change(did="did:plc:nonexistent", active=True)

    async def test_avatar_fetch_failure_on_reactivation(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """avatar fetch failure on reactivation doesn't raise."""
        artist.avatar_url = None
        await db_session.commit()

        with patch(
            "backend._internal.atproto.profile.fetch_user_avatar",
            new_callable=AsyncMock,
            side_effect=Exception("network error"),
        ):
            await ingest_account_status_change(did=artist.did, active=True)

        await db_session.refresh(artist)
        assert artist.avatar_url is None


# --- bluesky avatar mirroring tests ---


def _profile_record(cid: str | None) -> dict:
    """an `app.bsky.actor.profile` record, with or without an avatar blob."""
    record: dict = {
        "$type": "app.bsky.actor.profile",
        "displayName": "Brookie",
        "description": "hi",
    }
    if cid:
        record["avatar"] = {
            "$type": "blob",
            "ref": {"$link": cid},
            "mimeType": "image/jpeg",
            "size": 12345,
        }
    return record


class TestAvatarUrlFromProfileRecord:
    def test_builds_cdn_url_from_blob_ref(self) -> None:
        did = "did:plc:v46ojbiop5ebs5h7gaomixcc"
        url = avatar_url_from_profile_record(did, _profile_record("bafkreiavatar"))
        assert url == f"https://cdn.bsky.app/img/avatar/plain/{did}/bafkreiavatar@jpeg"

    def test_no_avatar_is_none(self) -> None:
        assert (
            avatar_url_from_profile_record("did:plc:x", _profile_record(None)) is None
        )

    @pytest.mark.parametrize(
        "avatar",
        [
            "not-a-dict",
            {"mimeType": "image/jpeg"},
            {"ref": "not-a-dict"},
            {"ref": {}},
            {"ref": {"$link": ""}},
        ],
    )
    def test_malformed_avatar_is_none(self, avatar: object) -> None:
        """a malformed blob yields None rather than a URL that 404s forever."""
        record = {"$type": "app.bsky.actor.profile", "avatar": avatar}
        assert avatar_url_from_profile_record("did:plc:x", record) is None


class TestIngestBskyProfileUpdate:
    async def test_mirrors_new_avatar(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """the regression: a profile-picture change updates the stored avatar.

        before this, nothing subscribed to `app.bsky.actor.profile`, so a
        changed avatar left a superseded blob CID in the database that 404s on
        the CDN and renders as a broken image.
        """
        artist.avatar_url = "https://cdn.bsky.app/img/avatar/plain/x/bafkreiold@jpeg"
        await db_session.commit()

        await ingest_bsky_profile_update(
            did=artist.did, record=_profile_record("bafkreinew")
        )

        await db_session.refresh(artist)
        assert artist.avatar_url == (
            f"https://cdn.bsky.app/img/avatar/plain/{artist.did}/bafkreinew@jpeg"
        )

    async def test_clears_avatar_when_removed(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """removing a profile picture clears ours rather than leaving a 404."""
        artist.avatar_url = "https://cdn.bsky.app/img/avatar/plain/x/bafkreiold@jpeg"
        await db_session.commit()

        await ingest_bsky_profile_update(did=artist.did, record=_profile_record(None))

        await db_session.refresh(artist)
        assert artist.avatar_url is None

    async def test_does_not_touch_display_name(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """display_name is editable in plyr, so mirroring would clobber it."""
        original = artist.display_name

        await ingest_bsky_profile_update(
            did=artist.did, record=_profile_record("bafkreinew")
        )

        await db_session.refresh(artist)
        assert artist.display_name == original

    async def test_skips_deactivated_artist(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """a deactivated account's avatar was cleared on purpose."""
        artist.deactivated = True
        artist.avatar_url = None
        await db_session.commit()

        await ingest_bsky_profile_update(
            did=artist.did, record=_profile_record("bafkreinew")
        )

        await db_session.refresh(artist)
        assert artist.avatar_url is None

    async def test_unknown_did_is_skipped(self, db_session: AsyncSession) -> None:
        await ingest_bsky_profile_update(
            did="did:plc:nonexistent", record=_profile_record("bafkreinew")
        )


class TestBskyProfileSubscription:
    async def test_bsky_profile_collection_is_subscribed(self) -> None:
        """without this in wantedCollections, avatar changes never reach us."""
        consumer = JetstreamConsumer()
        assert BSKY_PROFILE_COLLECTION in consumer._collections
        assert f"wantedCollections={BSKY_PROFILE_COLLECTION}" in consumer._build_url()

    async def test_dispatches_bsky_profile_update(self) -> None:
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:jetstream_test"}

        mock_docket = MagicMock()
        dispatched: list[object] = []
        mock_docket.add = MagicMock(
            side_effect=lambda fn: (dispatched.append(fn), AsyncMock())[1]
        )

        event = {
            "kind": "commit",
            "did": "did:plc:jetstream_test",
            "time_us": 1000000,
            "commit": {
                "collection": BSKY_PROFILE_COLLECTION,
                "operation": "update",
                "rkey": "self",
                "record": _profile_record("bafkreinew"),
                "cid": "bafynew",
            },
        }

        with patch("backend._internal.jetstream.get_docket", return_value=mock_docket):
            await consumer._process_event(event)

        assert dispatched == [ingest_bsky_profile_update]

    async def test_bsky_profile_does_not_route_to_plyr_profile_task(self) -> None:
        """`app.bsky.actor.profile` also ends in `.actor.profile`.

        the plyr branch matched on that suffix, so subscribing to bluesky's
        collection would have fed foreign records to `ingest_profile_update`,
        which validates against the `fm.plyr.actor.profile` schema and writes
        `bio`.
        """
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:jetstream_test"}

        mock_docket = MagicMock()
        dispatched: list[object] = []
        mock_docket.add = MagicMock(
            side_effect=lambda fn: (dispatched.append(fn), AsyncMock())[1]
        )

        event = {
            "kind": "commit",
            "did": "did:plc:jetstream_test",
            "time_us": 1000000,
            "commit": {
                "collection": BSKY_PROFILE_COLLECTION,
                "operation": "update",
                "rkey": "self",
                "record": _profile_record("bafkreinew"),
                "cid": "bafynew",
            },
        }

        with patch("backend._internal.jetstream.get_docket", return_value=mock_docket):
            await consumer._process_event(event)

        assert ingest_profile_update not in dispatched


class TestIngestTaskRegistration:
    async def test_every_ingest_task_is_registered_with_the_worker(self) -> None:
        """every dispatchable ingest task must be in the worker's registry.

        the registry is a hand-maintained list, and docket resolves a task by
        name at execution time: an unregistered one is dropped with a log line
        on the worker, not an error at the dispatch site. `ingest_identity_update`
        was missing, so 35 production dispatches over two weeks were dropped and
        no handle change, PDS migration, or avatar refresh ever applied.
        """
        import inspect

        from backend._internal.tasks import background_tasks, ingest

        dispatchable = {
            name
            for name, fn in inspect.getmembers(ingest, inspect.iscoroutinefunction)
            if name.startswith("ingest_") and fn.__module__ == ingest.__name__
        }
        registered = {fn.__name__ for fn in background_tasks}

        assert dispatchable - registered == set()


# --- account status semantics tests ---


class TestHidesContent:
    """`#account` is a statement about a host, not about a person."""

    @pytest.mark.parametrize(
        "status", ["deactivated", "deleted", "takendown", "suspended"]
    )
    def test_account_level_statuses_hide(self, status: str) -> None:
        assert hides_content(active=False, status=status) is True

    @pytest.mark.parametrize("status", ["throttled", "desynchronized"])
    def test_infrastructure_statuses_never_hide(self, status: str) -> None:
        """the regression: a PDS having a bad second is not a moderation event.

        production showed one DID flipping active false->true four times in 18
        hours; each false edge used to remove their whole catalogue from radio,
        the home feed, and for-you.
        """
        assert hides_content(active=False, status=status) is False

    def test_unexplained_inactive_does_not_hide(self) -> None:
        """`status` is optional in the lexicon. no reason given, no hiding."""
        assert hides_content(active=False, status=None) is False

    def test_active_never_hides(self) -> None:
        assert hides_content(active=True, status=None) is False


class TestAccountStatusSemantics:
    async def test_infra_status_leaves_artist_alone(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """a throttled host must not hide the catalogue or clear the avatar."""
        artist.avatar_url = "https://cdn.bsky.app/img/avatar/plain/x/bafkrei@jpeg"
        await db_session.commit()

        await ingest_account_status_change(
            did=artist.did, active=False, status="throttled"
        )

        await db_session.refresh(artist)
        assert artist.deactivated is False
        assert artist.avatar_url is not None
        assert artist.account_status == "throttled"

    async def test_deactivation_hides_and_records_why(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        await ingest_account_status_change(
            did=artist.did, active=False, status="deactivated"
        )

        await db_session.refresh(artist)
        assert artist.deactivated is True
        assert artist.account_status == "deactivated"

    async def test_reactivation_clears_status(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        artist.deactivated = True
        artist.account_status = "deactivated"
        await db_session.commit()

        with patch(
            "backend._internal.atproto.profile.fetch_user_avatar",
            new_callable=AsyncMock,
            return_value=None,
        ):
            await ingest_account_status_change(did=artist.did, active=True)

        await db_session.refresh(artist)
        assert artist.deactivated is False
        assert artist.account_status is None


class TestAccountReactivationOnRepoActivity:
    async def test_commit_clears_stale_flag(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """the sticky-flag regression.

        only an `#account` event could clear `deactivated`, so a missed
        reactivation edge hid an artist indefinitely. a commit proves the repo
        is being served.
        """
        artist.deactivated = True
        artist.account_status = "deactivated"
        artist.avatar_url = None
        await db_session.commit()

        with patch(
            "backend._internal.atproto.profile.fetch_user_avatar",
            new_callable=AsyncMock,
            return_value="https://cdn.bsky.app/img/avatar/plain/x/bafkrei@jpeg",
        ):
            await ingest_account_reactivated(did=artist.did)

        await db_session.refresh(artist)
        assert artist.deactivated is False
        assert artist.account_status is None
        assert artist.avatar_url is not None

    async def test_active_artist_is_untouched(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """no-op for the overwhelmingly common case."""
        artist.avatar_url = None
        await db_session.commit()

        with patch(
            "backend._internal.atproto.profile.fetch_user_avatar",
            new_callable=AsyncMock,
            return_value="https://example.com/should-not-be-fetched.jpg",
        ) as fetch:
            await ingest_account_reactivated(did=artist.did)

        fetch.assert_not_awaited()
        await db_session.refresh(artist)
        assert artist.avatar_url is None

    async def test_consumer_dispatches_only_for_flagged_dids(self) -> None:
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:flagged", "did:plc:normal"}
        consumer._deactivated_dids = {"did:plc:flagged"}

        mock_docket = MagicMock()
        dispatched: list[object] = []
        mock_docket.add = MagicMock(
            side_effect=lambda fn: (dispatched.append(fn), AsyncMock())[1]
        )

        def commit_event(did: str) -> dict:
            return {
                "kind": "commit",
                "did": did,
                "time_us": 1000000,
                "commit": {
                    "collection": "fm.plyr.track",
                    "operation": "create",
                    "rkey": "abc",
                    "record": {"title": "t"},
                    "cid": "bafy",
                },
            }

        with patch("backend._internal.jetstream.get_docket", return_value=mock_docket):
            await consumer._process_event(commit_event("did:plc:normal"))
            assert ingest_account_reactivated not in dispatched

            await consumer._process_event(commit_event("did:plc:flagged"))
            assert ingest_account_reactivated in dispatched

        # dispatched once, not on every subsequent commit
        dispatched.clear()
        with patch("backend._internal.jetstream.get_docket", return_value=mock_docket):
            await consumer._process_event(commit_event("did:plc:flagged"))
        assert ingest_account_reactivated not in dispatched

    async def test_account_event_passes_status_through(self) -> None:
        """the status field decides everything, so it must reach the task."""
        consumer = JetstreamConsumer()
        consumer._known_dids = {"did:plc:jetstream_test"}

        mock_docket = MagicMock()
        captured: list[dict] = []

        async def capture(**kwargs: object) -> None:
            captured.append(dict(kwargs))

        mock_docket.add = MagicMock(return_value=capture)

        event = {
            "kind": "account",
            "did": "did:plc:jetstream_test",
            "time_us": 1000000,
            "account": {"active": False, "status": "throttled", "seq": 1},
        }

        with patch("backend._internal.jetstream.get_docket", return_value=mock_docket):
            await consumer._process_event(event)

        assert captured == [
            {"did": "did:plc:jetstream_test", "active": False, "status": "throttled"}
        ]


class TestMigratedPdsIsNotDeactivation:
    """leaving a PDS deactivates the repo on the host you left.

    every artist wrongly hidden on plyr got there this way: their old
    bsky-hosted PDS emitted `active=false status=deactivated` — true of that
    host — while the account was alive on a PDS they had moved to. twelve more
    were one reconciliation run away from the same fate.
    """

    async def test_inactive_event_ignored_when_current_pds_serves_repo(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        artist.avatar_url = "https://cdn.bsky.app/img/avatar/plain/x/bafkrei@jpeg"
        await db_session.commit()

        with patch(
            "backend._internal.tasks.ingest.repo_is_live_on_current_pds",
            new_callable=AsyncMock,
            return_value=True,
        ):
            await ingest_account_status_change(
                did=artist.did, active=False, status="deactivated"
            )

        await db_session.refresh(artist)
        assert artist.deactivated is False
        assert artist.account_status is None
        assert artist.avatar_url is not None

    async def test_genuine_deactivation_still_hides(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """the current PDS agrees the repo is gone — hide, as before."""
        with patch(
            "backend._internal.tasks.ingest.repo_is_live_on_current_pds",
            new_callable=AsyncMock,
            return_value=False,
        ):
            await ingest_account_status_change(
                did=artist.did, active=False, status="deactivated"
            )

        await db_session.refresh(artist)
        assert artist.deactivated is True
        assert artist.account_status == "deactivated"

    async def test_unresolvable_pds_does_not_rescue(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """`None` means "cannot tell", which must not be read as "still live".

        otherwise a slingshot outage would silently stop all deactivations from
        applying — the mirror of the bug being fixed.
        """
        with patch(
            "backend._internal.tasks.ingest.repo_is_live_on_current_pds",
            new_callable=AsyncMock,
            return_value=None,
        ):
            await ingest_account_status_change(
                did=artist.did, active=False, status="deactivated"
            )

        await db_session.refresh(artist)
        assert artist.deactivated is True


# --- commit ordering (#1736) ---


class TestStaleCommitGuard:
    """the firehose can re-deliver a repo's commit history.

    observed in production 2026-07-30: 37 `track.update` events for one URI
    whose PDS record had not changed in half an hour, walking `r2_url` back to
    a 19-minute-old revision while `file_id` stayed correct. `rev` is monotonic
    per repo and survives re-delivery; `time_us` does not.
    """

    async def test_replayed_older_commit_does_not_overwrite_newer(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri

        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"title": "current", "audioUrl": "https://r2.example.com/new.mp3"},
            uri=uri,
            cid="bafynew",
            rev="3mrtqf7ut6s22",
        )

        # the same repo re-emits an earlier commit
        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"title": "stale", "audioUrl": "https://r2.example.com/old.mp3"},
            uri=uri,
            cid="bafyold",
            rev="3mrtaaaaaaa22",
        )

        db_session.expire_all()
        updated = await db_session.scalar(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert updated is not None
        assert updated.title == "current"
        assert updated.r2_url == "https://r2.example.com/new.mp3"
        assert updated.atproto_record_rev == "3mrtqf7ut6s22"

    async def test_redelivery_of_the_same_commit_is_a_noop(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        rev = "3mrtqf7ut6s22"

        for title in ("applied", "should not land"):
            await ingest_track_update(
                did=artist.did,
                rkey="existing",
                record={"title": title},
                uri=uri,
                cid="bafysame",
                rev=rev,
            )

        db_session.expire_all()
        updated = await db_session.scalar(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert updated is not None
        assert updated.title == "applied"

    async def test_newer_commit_still_applies(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri

        for rev, title in (("3mrtaaaaaaa22", "first"), ("3mrtqf7ut6s22", "second")):
            await ingest_track_update(
                did=artist.did,
                rkey="existing",
                record={"title": title},
                uri=uri,
                cid=f"bafy{rev}",
                rev=rev,
            )

        db_session.expire_all()
        updated = await db_session.scalar(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert updated is not None
        assert updated.title == "second"
        assert updated.atproto_record_rev == "3mrtqf7ut6s22"

    async def test_update_without_rev_still_applies(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """a missing rev must not silently drop the update (unordered, as before)."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        track.atproto_record_rev = "3mrtqf7ut6s22"
        await db_session.commit()

        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={"title": "applied anyway"},
            uri=uri,
            cid="bafynorev",
            rev=None,
        )

        db_session.expire_all()
        updated = await db_session.scalar(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert updated is not None
        assert updated.title == "applied anyway"

    async def test_create_records_the_rev_as_a_baseline(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """without a baseline the first replayed update would win."""
        rkey = f"baseline_{uuid.uuid4().hex[:8]}"
        uri = f"at://{artist.did}/fm.plyr.track/{rkey}"

        await ingest_track_create(
            did=artist.did,
            rkey=rkey,
            record={
                "title": "created",
                "artist": "Test Artist",
                "fileId": "baseline_file",
                "fileType": "mp3",
                "audioUrl": "https://r2.example.com/baseline.mp3",
                "duration": 120,
                "createdAt": _recent_ts(),
            },
            uri=uri,
            cid="bafybaseline",
            rev="3mrtqf7ut6s22",
        )

        db_session.expire_all()
        created = await db_session.scalar(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert created is not None
        assert created.atproto_record_rev == "3mrtqf7ut6s22"


class TestAudioExistenceOnUpdate:
    async def test_update_ignores_audio_url_with_no_backing_object(
        self,
        db_session: AsyncSession,
        artist: Artist,
        track: Track,
        _mock_audio_object_exists: MagicMock,
    ) -> None:
        """a replayed url can name a blob already pruned as an old revision."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        original = track.r2_url
        _mock_audio_object_exists.return_value = False

        await ingest_track_update(
            did=artist.did,
            rkey="existing",
            record={
                "title": "metadata still lands",
                "audioUrl": "https://r2.example.com/pruned.mp3",
            },
            uri=uri,
            cid="bafypruned",
            rev="3mrtqf7ut6s22",
        )

        db_session.expire_all()
        updated = await db_session.scalar(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert updated is not None
        assert updated.title == "metadata still lands"
        assert updated.r2_url == original


# --- host failover (#1739 follow-up) ---


class TestHostRotation:
    """one instance can serve some collections and silently drop others.

    jetstream2 did exactly that for 10h on 2026-07-30 without ever
    disconnecting, so reconnect-driven rotation alone would not have caught it.
    """

    def test_rotates_through_configured_hosts(self) -> None:
        consumer = JetstreamConsumer()
        with patch.object(settings.jetstream, "url", None):
            hosts = settings.jetstream.hosts
            seen = []
            for _ in range(len(hosts) + 2):
                seen.append(consumer._current_endpoint())
                consumer._rotate_host()

        assert seen[0] == f"wss://{hosts[0]}/subscribe"
        assert seen[1] == f"wss://{hosts[1]}/subscribe"
        # wraps rather than running off the end
        assert seen[len(hosts)] == seen[0]
        assert len(set(seen)) == len(hosts)

    def test_a_pinned_url_is_never_rotated_away_from(self) -> None:
        consumer = JetstreamConsumer()
        with patch.object(settings.jetstream, "url", "wss://pinned.example/sub"):
            consumer._rotate_host()
            consumer._rotate_host()
            assert consumer._current_endpoint() == "wss://pinned.example/sub"

    def test_rotation_rewinds_the_cursor_for_instance_lag(self) -> None:
        """the host we move to may sit behind the one we left."""
        consumer = JetstreamConsumer()
        consumer._cursor = 1_000_000_000
        with patch.object(settings.jetstream, "url", None):
            consumer._rotate_host()
        assert consumer._cursor == 1_000_000_000 - 10_000_000

    async def test_a_rewound_cursor_survives_the_reload_before_reconnect(self) -> None:
        """`run` reloads the cursor from redis before every connection; the
        stored value is the pre-rewind position, so loading must never move
        forward past what is in memory."""
        consumer = JetstreamConsumer()
        consumer._cursor = 1_000_000_000 - 10_000_000
        redis = MagicMock()
        redis.get = AsyncMock(return_value="1000000000")
        with patch(
            "backend._internal.jetstream.get_async_redis_client", return_value=redis
        ):
            await consumer._load_cursor()
        assert consumer._cursor == 1_000_000_000 - 10_000_000


def _redis_with_write(written: float | None) -> MagicMock:
    redis = MagicMock()
    redis.get = AsyncMock(return_value=None if written is None else str(written))
    return redis


class TestEchoDrivenRotation:
    """a host is only judged blind when plyr's own write fails to echo."""

    def _consumer(self) -> JetstreamConsumer:
        consumer = JetstreamConsumer()
        consumer._started_at = time.time() - 3600
        consumer._cursor = int(time.time() * 1_000_000)
        return consumer

    async def _check(self, consumer: JetstreamConsumer, written: float | None) -> bool:
        with (
            patch.object(settings.jetstream, "echo_grace_seconds", 120.0),
            patch(
                "backend._internal.jetstream.get_async_redis_client",
                return_value=_redis_with_write(written),
            ),
        ):
            return await consumer._own_write_unechoed()

    async def test_a_write_unechoed_past_grace_rotates_and_replays_it(self) -> None:
        consumer = self._consumer()
        written = time.time() - 300
        consumer._last_own_event = written - 120  # last thing of ours predates it
        assert await self._check(consumer, written) is True
        assert consumer._cursor == int((written - 10) * 1_000_000)

    async def test_one_rotation_per_write(self) -> None:
        """the next host missing the record too means the network lacks it."""
        consumer = self._consumer()
        written = time.time() - 300
        assert await self._check(consumer, written) is True
        consumer._last_write_check = 0.0
        assert await self._check(consumer, written) is False

    async def test_an_echoed_write_is_not_blind(self) -> None:
        consumer = self._consumer()
        written = time.time() - 300
        consumer._last_own_event = written + 3
        assert await self._check(consumer, written) is False

    async def test_clock_skew_between_stamp_and_firehose_is_tolerated(self) -> None:
        """jetstream stamps `time_us` on its own clock; a few seconds behind
        the app machine's write stamp is still the echo, not a blind host."""
        consumer = self._consumer()
        written = time.time() - 300
        consumer._last_own_event = written - 5
        assert await self._check(consumer, written) is False

    async def test_a_write_inside_grace_waits(self) -> None:
        consumer = self._consumer()
        assert await self._check(consumer, time.time() - 30) is False

    async def test_a_quiet_network_never_rotates(self) -> None:
        """no write stamp at all — the old timer-based heuristic is gone."""
        consumer = self._consumer()
        consumer._last_own_event = 0.0
        assert await self._check(consumer, None) is False
        assert not hasattr(consumer, "_is_blind")

    async def test_a_write_before_startup_is_ignored(self) -> None:
        """its echo may have arrived before this process existed."""
        consumer = self._consumer()
        assert await self._check(consumer, consumer._started_at - 10) is False

    async def test_detection_can_be_disabled(self) -> None:
        consumer = self._consumer()
        with patch.object(settings.jetstream, "echo_grace_seconds", 0.0):
            assert await consumer._own_write_unechoed() is False

    async def test_checks_redis_at_most_every_ten_seconds(self) -> None:
        consumer = self._consumer()
        redis = _redis_with_write(time.time() - 300)
        with (
            patch.object(settings.jetstream, "echo_grace_seconds", 120.0),
            patch(
                "backend._internal.jetstream.get_async_redis_client",
                return_value=redis,
            ),
        ):
            consumer._last_write_check = time.time()
            assert await consumer._own_write_unechoed() is False
        redis.get.assert_not_called()

    def test_bsky_profile_events_do_not_count_as_ours(self) -> None:
        """the exact traffic that made the blind host look alive."""
        consumer = JetstreamConsumer()
        bsky = {"commit": {"collection": BSKY_PROFILE_COLLECTION}}
        ours = {"commit": {"collection": settings.atproto.track_collection}}
        assert consumer._is_own_collection_event(bsky) is False
        assert consumer._is_own_collection_event(ours) is True
        assert consumer._is_own_collection_event({"kind": "identity"}) is False
