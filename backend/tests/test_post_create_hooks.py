"""tests for shared post-creation hooks."""

from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.atproto.client import pds_blob_url
from backend._internal.tasks.hooks import resolve_audio_url, run_post_track_create_hooks
from backend.models import Artist, Track

# --- fixtures ---

MOCK_SETTINGS_PATH = "backend._internal.tasks.hooks.settings"
MOCK_COPYRIGHT_PATH = "backend._internal.tasks.hooks.schedule_copyright_scan"
MOCK_EMBEDDING_PATH = "backend._internal.tasks.hooks.schedule_embedding_generation"
MOCK_GENRE_PATH = "backend._internal.tasks.hooks.schedule_genre_classification"
MOCK_NOTIFICATION_PATH = "backend._internal.notifications.notification_service"
MOCK_REDIS_PATH = "backend._internal.tasks.hooks.get_async_redis_client"


async def _create_artist(db: AsyncSession, pds_url: str | None = None) -> Artist:
    artist = Artist(
        did="did:plc:hooks_test",
        handle="hooks.test.social",
        display_name="Hooks Artist",
        pds_url=pds_url or "https://bsky.social",
    )
    db.add(artist)
    await db.commit()
    return artist


async def _create_track(
    db: AsyncSession,
    artist: Artist,
    *,
    r2_url: str | None = "https://r2.example.com/test.mp3",
    audio_storage: str = "r2",
    pds_blob_cid: str | None = None,
    notification_sent: bool = False,
) -> Track:
    track = Track(
        title="Test Track",
        file_id="hooks_file_001",
        file_type="mp3",
        artist_did=artist.did,
        r2_url=r2_url,
        audio_storage=audio_storage,
        pds_blob_cid=pds_blob_cid,
        notification_sent=notification_sent,
    )
    db.add(track)
    await db.commit()
    return track


# --- pds_blob_url unit test ---


class TestPdsBlobUrl:
    def test_constructs_url(self) -> None:
        url = pds_blob_url("https://bsky.social", "did:plc:abc", "bafycid")
        assert url == (
            "https://bsky.social/xrpc/com.atproto.sync.getBlob"
            "?did=did:plc:abc&cid=bafycid"
        )


# --- resolve_audio_url tests ---


class TestResolveAudioUrl:
    async def test_r2_url(self, db_session: AsyncSession) -> None:
        artist = await _create_artist(db_session)
        track = await _create_track(db_session, artist)
        url = await resolve_audio_url(track.id)
        assert url == "https://r2.example.com/test.mp3"

    async def test_pds_blob(self, db_session: AsyncSession) -> None:
        artist = await _create_artist(db_session, pds_url="https://pds.example.com")
        track = await _create_track(
            db_session,
            artist,
            r2_url=None,
            audio_storage="pds",
            pds_blob_cid="bafyblob",
        )
        url = await resolve_audio_url(track.id)
        expected = pds_blob_url("https://pds.example.com", artist.did, "bafyblob")
        assert url == expected

    async def test_none_when_no_audio(self, db_session: AsyncSession) -> None:
        artist = await _create_artist(db_session)
        track = await _create_track(
            db_session, artist, r2_url=None, audio_storage="pds", pds_blob_cid=None
        )
        url = await resolve_audio_url(track.id)
        assert url is None

    async def test_none_for_missing_track(self, db_session: AsyncSession) -> None:
        url = await resolve_audio_url(999999)
        assert url is None


# --- run_post_track_create_hooks tests ---


class TestRunPostTrackCreateHooks:
    async def test_schedules_copyright_scan(self, db_session: AsyncSession) -> None:
        artist = await _create_artist(db_session)
        track = await _create_track(db_session, artist)

        with (
            patch(MOCK_COPYRIGHT_PATH, new_callable=AsyncMock) as mock_copyright,
            patch(MOCK_EMBEDDING_PATH, new_callable=AsyncMock),
            patch(MOCK_GENRE_PATH, new_callable=AsyncMock),
            patch(MOCK_NOTIFICATION_PATH),
            patch(MOCK_REDIS_PATH, return_value=AsyncMock()),
            patch(MOCK_SETTINGS_PATH) as mock_settings,
        ):
            mock_settings.modal.enabled = False
            mock_settings.turbopuffer.enabled = False
            mock_settings.replicate.enabled = False
            await run_post_track_create_hooks(
                track.id, audio_url="https://r2.example.com/test.mp3"
            )

        mock_copyright.assert_called_once_with(
            track.id, "https://r2.example.com/test.mp3"
        )

    async def test_schedules_embedding(self, db_session: AsyncSession) -> None:
        artist = await _create_artist(db_session)
        track = await _create_track(db_session, artist)

        with (
            patch(MOCK_COPYRIGHT_PATH, new_callable=AsyncMock),
            patch(MOCK_EMBEDDING_PATH, new_callable=AsyncMock) as mock_embed,
            patch(MOCK_GENRE_PATH, new_callable=AsyncMock),
            patch(MOCK_NOTIFICATION_PATH),
            patch(MOCK_REDIS_PATH, return_value=AsyncMock()),
            patch(MOCK_SETTINGS_PATH) as mock_settings,
        ):
            mock_settings.modal.enabled = True
            mock_settings.turbopuffer.enabled = True
            mock_settings.replicate.enabled = False
            await run_post_track_create_hooks(
                track.id, audio_url="https://r2.example.com/test.mp3"
            )

        mock_embed.assert_called_once_with(track.id, "https://r2.example.com/test.mp3")

    async def test_schedules_genre_classification(
        self, db_session: AsyncSession
    ) -> None:
        artist = await _create_artist(db_session)
        track = await _create_track(db_session, artist)

        with (
            patch(MOCK_COPYRIGHT_PATH, new_callable=AsyncMock),
            patch(MOCK_EMBEDDING_PATH, new_callable=AsyncMock),
            patch(MOCK_GENRE_PATH, new_callable=AsyncMock) as mock_genre,
            patch(MOCK_NOTIFICATION_PATH),
            patch(MOCK_REDIS_PATH, return_value=AsyncMock()),
            patch(MOCK_SETTINGS_PATH) as mock_settings,
        ):
            mock_settings.modal.enabled = False
            mock_settings.turbopuffer.enabled = False
            mock_settings.replicate.enabled = True
            await run_post_track_create_hooks(
                track.id, audio_url="https://r2.example.com/test.mp3"
            )

        mock_genre.assert_called_once_with(track.id, "https://r2.example.com/test.mp3")

    async def test_sends_notification(self, db_session: AsyncSession) -> None:
        artist = await _create_artist(db_session)
        track = await _create_track(db_session, artist)

        mock_service = AsyncMock()
        mock_service.send_track_notification = AsyncMock(return_value=None)

        with (
            patch(MOCK_COPYRIGHT_PATH, new_callable=AsyncMock),
            patch(MOCK_EMBEDDING_PATH, new_callable=AsyncMock),
            patch(MOCK_GENRE_PATH, new_callable=AsyncMock),
            patch(MOCK_NOTIFICATION_PATH, mock_service),
            patch(MOCK_REDIS_PATH, return_value=AsyncMock()),
            patch(MOCK_SETTINGS_PATH) as mock_settings,
        ):
            mock_settings.modal.enabled = False
            mock_settings.turbopuffer.enabled = False
            mock_settings.replicate.enabled = False
            await run_post_track_create_hooks(
                track.id, audio_url="https://r2.example.com/test.mp3"
            )

        mock_service.send_track_notification.assert_called_once()

    async def test_skips_notification_when_flagged(
        self, db_session: AsyncSession
    ) -> None:
        artist = await _create_artist(db_session)
        track = await _create_track(db_session, artist)

        mock_service = AsyncMock()
        mock_service.send_track_notification = AsyncMock(return_value=None)

        with (
            patch(MOCK_COPYRIGHT_PATH, new_callable=AsyncMock),
            patch(MOCK_EMBEDDING_PATH, new_callable=AsyncMock),
            patch(MOCK_GENRE_PATH, new_callable=AsyncMock),
            patch(MOCK_NOTIFICATION_PATH, mock_service),
            patch(MOCK_REDIS_PATH, return_value=AsyncMock()),
            patch(MOCK_SETTINGS_PATH) as mock_settings,
        ):
            mock_settings.modal.enabled = False
            mock_settings.turbopuffer.enabled = False
            mock_settings.replicate.enabled = False
            await run_post_track_create_hooks(
                track.id,
                audio_url="https://r2.example.com/test.mp3",
                skip_notification=True,
            )

        mock_service.send_track_notification.assert_not_called()
        # notification_sent should be marked True so Jetstream won't fire it later
        await db_session.refresh(track)
        assert track.notification_sent is True

    async def test_skip_notification_prevents_jetstream_resend(
        self, db_session: AsyncSession
    ) -> None:
        """regression: upload path skips notification, then Jetstream calls hooks
        again without skip_notification — the DM should NOT fire."""
        artist = await _create_artist(db_session)
        track = await _create_track(db_session, artist)

        mock_service = AsyncMock()
        mock_service.send_track_notification = AsyncMock(return_value=None)

        with (
            patch(MOCK_COPYRIGHT_PATH, new_callable=AsyncMock),
            patch(MOCK_EMBEDDING_PATH, new_callable=AsyncMock),
            patch(MOCK_GENRE_PATH, new_callable=AsyncMock),
            patch(MOCK_NOTIFICATION_PATH, mock_service),
            patch(MOCK_REDIS_PATH, return_value=AsyncMock()),
            patch(MOCK_SETTINGS_PATH) as mock_settings,
        ):
            mock_settings.modal.enabled = False
            mock_settings.turbopuffer.enabled = False
            mock_settings.replicate.enabled = False

            # 1. upload path — skip notification
            await run_post_track_create_hooks(
                track.id,
                audio_url="https://r2.example.com/test.mp3",
                skip_notification=True,
            )
            mock_service.send_track_notification.assert_not_called()

            # 2. Jetstream ingest — no skip flag
            await run_post_track_create_hooks(
                track.id,
                audio_url="https://r2.example.com/test.mp3",
            )
            # notification should still not fire — notification_sent was marked True
            mock_service.send_track_notification.assert_not_called()

    async def test_skips_notification_when_already_sent(
        self, db_session: AsyncSession
    ) -> None:
        artist = await _create_artist(db_session)
        track = await _create_track(db_session, artist, notification_sent=True)

        mock_service = AsyncMock()
        mock_service.send_track_notification = AsyncMock(return_value=None)

        with (
            patch(MOCK_COPYRIGHT_PATH, new_callable=AsyncMock),
            patch(MOCK_EMBEDDING_PATH, new_callable=AsyncMock),
            patch(MOCK_GENRE_PATH, new_callable=AsyncMock),
            patch(MOCK_NOTIFICATION_PATH, mock_service),
            patch(MOCK_REDIS_PATH, return_value=AsyncMock()),
            patch(MOCK_SETTINGS_PATH) as mock_settings,
        ):
            mock_settings.modal.enabled = False
            mock_settings.turbopuffer.enabled = False
            mock_settings.replicate.enabled = False
            await run_post_track_create_hooks(
                track.id, audio_url="https://r2.example.com/test.mp3"
            )

        mock_service.send_track_notification.assert_not_called()

    async def test_skips_copyright_when_flagged(self, db_session: AsyncSession) -> None:
        artist = await _create_artist(db_session)
        track = await _create_track(db_session, artist)

        with (
            patch(MOCK_COPYRIGHT_PATH, new_callable=AsyncMock) as mock_copyright,
            patch(MOCK_EMBEDDING_PATH, new_callable=AsyncMock),
            patch(MOCK_GENRE_PATH, new_callable=AsyncMock),
            patch(MOCK_NOTIFICATION_PATH),
            patch(MOCK_REDIS_PATH, return_value=AsyncMock()),
            patch(MOCK_SETTINGS_PATH) as mock_settings,
        ):
            mock_settings.modal.enabled = False
            mock_settings.turbopuffer.enabled = False
            mock_settings.replicate.enabled = False
            await run_post_track_create_hooks(
                track.id,
                audio_url="https://r2.example.com/test.mp3",
                skip_copyright=True,
            )

        mock_copyright.assert_not_called()

    async def test_invalidates_cache(self, db_session: AsyncSession) -> None:
        artist = await _create_artist(db_session)
        track = await _create_track(db_session, artist)

        mock_redis = AsyncMock()

        with (
            patch(MOCK_COPYRIGHT_PATH, new_callable=AsyncMock),
            patch(MOCK_EMBEDDING_PATH, new_callable=AsyncMock),
            patch(MOCK_GENRE_PATH, new_callable=AsyncMock),
            patch(MOCK_NOTIFICATION_PATH),
            patch(MOCK_REDIS_PATH, return_value=mock_redis),
            patch(MOCK_SETTINGS_PATH) as mock_settings,
        ):
            mock_settings.modal.enabled = False
            mock_settings.turbopuffer.enabled = False
            mock_settings.replicate.enabled = False
            await run_post_track_create_hooks(
                track.id, audio_url="https://r2.example.com/test.mp3"
            )

        mock_redis.delete.assert_called_once_with("plyr:tracks:discovery")

    async def test_no_audio_url_skips_audio_tasks(
        self, db_session: AsyncSession
    ) -> None:
        artist = await _create_artist(db_session)
        track = await _create_track(
            db_session, artist, r2_url=None, audio_storage="pds", pds_blob_cid=None
        )

        mock_service = AsyncMock()
        mock_service.send_track_notification = AsyncMock(return_value=None)

        with (
            patch(MOCK_COPYRIGHT_PATH, new_callable=AsyncMock) as mock_copyright,
            patch(MOCK_EMBEDDING_PATH, new_callable=AsyncMock) as mock_embed,
            patch(MOCK_GENRE_PATH, new_callable=AsyncMock) as mock_genre,
            patch(MOCK_NOTIFICATION_PATH, mock_service),
            patch(MOCK_REDIS_PATH, return_value=AsyncMock()),
            patch(MOCK_SETTINGS_PATH) as mock_settings,
        ):
            mock_settings.modal.enabled = True
            mock_settings.turbopuffer.enabled = True
            mock_settings.replicate.enabled = True
            await run_post_track_create_hooks(track.id, audio_url=None)

        # audio-dependent tasks not called
        mock_copyright.assert_not_called()
        mock_embed.assert_not_called()
        mock_genre.assert_not_called()
        # notification still fires
        mock_service.send_track_notification.assert_called_once()
