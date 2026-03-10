"""tests for Jetstream consumer and ingest tasks."""

from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from docket import Perpetual
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.jetstream import JetstreamConsumer, consume_jetstream
from backend._internal.tasks.ingest import (
    ingest_comment_create,
    ingest_comment_delete,
    ingest_like_create,
    ingest_like_delete,
    ingest_list_create,
    ingest_track_create,
    ingest_track_delete,
    ingest_track_update,
)
from backend.models import Artist, Playlist, Track, TrackComment, TrackLike

# --- fixtures ---


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    a = Artist(
        did="did:plc:jetstream_test",
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
        atproto_record_uri="at://did:plc:jetstream_test/fm.plyr.track/existing",
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
            "fileId": "js_file_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/js_file_001.mp3",
            "duration": 180,
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

    async def test_dedup_by_uri(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """duplicate AT URI is silently skipped."""
        assert track.atproto_record_uri is not None
        record = {"title": "Duplicate"}
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
            record={"title": "Ghost"},
            uri="at://did:plc:nonexistent/fm.plyr.track/rk1",
            cid="bafy",
        )

        result = await db_session.execute(
            select(Track).where(Track.artist_did == "did:plc:nonexistent")
        )
        assert result.scalar_one_or_none() is None

    async def test_pds_audio_storage(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """track with audioBlob gets audio_storage='pds'."""
        record = {
            "title": "PDS Track",
            "fileId": "pds_001",
            "fileType": "mp3",
            "audioBlob": {"ref": {"$link": "bafyaudioblob"}, "mimeType": "audio/mpeg"},
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.track/pds1"

        await ingest_track_create(
            did=artist.did, rkey="pds1", record=record, uri=uri, cid="bafynew"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        assert track.audio_storage == "pds"
        assert track.pds_blob_cid == "bafyaudioblob"
        assert track.r2_url is None


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
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.like/like1"

        await ingest_like_create(did=artist.did, rkey="like1", record=record, uri=uri)

        result = await db_session.execute(
            select(TrackLike).where(TrackLike.atproto_like_uri == uri)
        )
        like = result.scalar_one()
        assert like.track_id == track.id
        assert like.user_did == artist.did

    async def test_skips_unknown_track(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """like for unknown subject track is skipped."""
        record = {
            "subject": {"uri": "at://did:plc:jetstream_test/fm.plyr.track/nonexistent"},
        }
        await ingest_like_create(
            did=artist.did,
            rkey="like2",
            record=record,
            uri="at://did:plc:jetstream_test/fm.plyr.like/like2",
        )

        result = await db_session.execute(select(TrackLike))
        assert result.scalar_one_or_none() is None


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
        }
        uri = "at://did:plc:jetstream_test/fm.plyr.comment/c1"

        await ingest_comment_create(did=artist.did, rkey="c1", record=record, uri=uri)

        result = await db_session.execute(
            select(TrackComment).where(TrackComment.atproto_comment_uri == uri)
        )
        comment = result.scalar_one()
        assert comment.text == "great track!"
        assert comment.timestamp_ms == 5000

    async def test_skips_unknown_track(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """comment for unknown track is skipped."""
        record = {
            "subject": {"uri": "at://did:plc:jetstream_test/fm.plyr.track/nope"},
            "text": "nope",
            "timestampMs": 0,
        }
        await ingest_comment_create(
            did=artist.did,
            rkey="c2",
            record=record,
            uri="at://did:plc:jetstream_test/fm.plyr.comment/c2",
        )

        result = await db_session.execute(select(TrackComment))
        assert result.scalar_one_or_none() is None


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

    async def test_skips_album_type(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """listType=album is not created as a Playlist."""
        record = {
            "listType": "album",
            "name": "My Album",
        }
        await ingest_list_create(
            did=artist.did,
            rkey="al1",
            record=record,
            uri="at://did:plc:jetstream_test/fm.plyr.list/al1",
        )

        result = await db_session.execute(select(Playlist))
        assert result.scalar_one_or_none() is None


# --- audio PDS redirect test ---


class TestAudioPdsRedirect:
    async def test_pds_redirect(
        self, db_session: AsyncSession, artist: Artist, client: object
    ) -> None:
        """PDS-only track redirects to getBlob endpoint."""
        from fastapi.testclient import TestClient

        assert isinstance(client, TestClient)

        # create a PDS-only track (no r2_url)
        pds_track = Track(
            title="PDS Only",
            file_id="pds_file_001",
            file_type="mp3",
            artist_did=artist.did,
            r2_url=None,
            audio_storage="pds",
            pds_blob_cid="bafyaudiocid123",
            atproto_record_uri="at://did:plc:jetstream_test/fm.plyr.track/pdsonly",
        )
        db_session.add(pds_track)
        await db_session.commit()

        response = client.get(f"/audio/{pds_track.file_id}", follow_redirects=False)

        assert response.status_code == 307
        location = response.headers["location"]
        assert "com.atproto.sync.getBlob" in location
        assert f"did={artist.did}" in location
        assert f"cid={pds_track.pds_blob_cid}" in location
