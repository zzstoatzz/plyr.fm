"""tests for `run_post_track_audio_replace_hooks`.

verifies the hook invalidates stale CopyrightScan rows, re-fires copyright/
embedding/genre tasks against the new audio bytes, and respects the auto-tag
opt-in for genre re-classification.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.tasks.hooks import run_post_track_audio_replace_hooks
from backend.models import Artist, CopyrightScan

from ._helpers import make_track


class TestPostReplaceHooks:
    async def test_invalidates_old_copyright_scan_rows_and_reschedules(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        track = make_track(file_id="NEW")
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        # an old scan that should be invalidated by the replace hook
        db_session.add(
            CopyrightScan(track_id=track.id, is_flagged=False, highest_score=10)
        )
        await db_session.commit()

        with (
            patch(
                "backend._internal.tasks.hooks.schedule_copyright_scan",
                new_callable=AsyncMock,
            ) as mock_scan,
            patch(
                "backend._internal.tasks.hooks.schedule_embedding_generation",
                new_callable=AsyncMock,
            ),
            patch(
                "backend._internal.tasks.hooks.schedule_genre_classification",
                new_callable=AsyncMock,
            ),
            patch(
                "backend._internal.tasks.hooks.invalidate_tracks_discovery_cache",
                new_callable=AsyncMock,
            ),
            patch("backend._internal.tasks.hooks.settings") as mock_settings,
        ):
            mock_settings.modal.enabled = False
            mock_settings.turbopuffer.enabled = False
            mock_settings.replicate.enabled = False
            await run_post_track_audio_replace_hooks(
                track.id, audio_url="https://audio.example/NEW.mp3"
            )

        # old scan was deleted
        remaining = await db_session.execute(
            select(CopyrightScan).where(CopyrightScan.track_id == track.id)
        )
        assert remaining.scalars().all() == []

        # new scan was scheduled
        mock_scan.assert_called_once_with(track.id, "https://audio.example/NEW.mp3")

    async def test_only_reclassifies_genres_when_auto_tag_was_set(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        """auto-tag was a per-upload opt-in. don't re-fire it on a manual
        replace if the user never asked for it — they may have hand-tagged."""
        # track WITHOUT auto_tag flag
        track = make_track(file_id="NEW", auto_tag=False)
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        with (
            patch(
                "backend._internal.tasks.hooks.schedule_copyright_scan",
                new_callable=AsyncMock,
            ),
            patch(
                "backend._internal.tasks.hooks.schedule_embedding_generation",
                new_callable=AsyncMock,
            ),
            patch(
                "backend._internal.tasks.hooks.schedule_genre_classification",
                new_callable=AsyncMock,
            ) as mock_genre,
            patch(
                "backend._internal.tasks.hooks.invalidate_tracks_discovery_cache",
                new_callable=AsyncMock,
            ),
            patch("backend._internal.tasks.hooks.settings") as mock_settings,
        ):
            mock_settings.modal.enabled = False
            mock_settings.turbopuffer.enabled = False
            mock_settings.replicate.enabled = True
            await run_post_track_audio_replace_hooks(
                track.id, audio_url="https://audio.example/NEW.mp3"
            )

        mock_genre.assert_not_called()

    async def test_reclassifies_genres_when_auto_tag_present(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        track = make_track(file_id="NEW", auto_tag=True)
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        with (
            patch(
                "backend._internal.tasks.hooks.schedule_copyright_scan",
                new_callable=AsyncMock,
            ),
            patch(
                "backend._internal.tasks.hooks.schedule_embedding_generation",
                new_callable=AsyncMock,
            ),
            patch(
                "backend._internal.tasks.hooks.schedule_genre_classification",
                new_callable=AsyncMock,
            ) as mock_genre,
            patch(
                "backend._internal.tasks.hooks.invalidate_tracks_discovery_cache",
                new_callable=AsyncMock,
            ),
            patch("backend._internal.tasks.hooks.settings") as mock_settings,
        ):
            mock_settings.modal.enabled = False
            mock_settings.turbopuffer.enabled = False
            mock_settings.replicate.enabled = True
            await run_post_track_audio_replace_hooks(
                track.id, audio_url="https://audio.example/NEW.mp3"
            )

        mock_genre.assert_called_once_with(track.id, "https://audio.example/NEW.mp3")
