"""tests for the audio revision history surface.

three things to cover:
1. prune_revisions enforces MAX_REVISIONS_PER_TRACK and deletes orphan blobs
2. GET /tracks/{id}/revisions: owner-only history listing
3. POST /tracks/{id}/revisions/{revision_id}/restore: pointer-swap + republish
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.track_revisions import prune_revisions
from backend.models import MAX_REVISIONS_PER_TRACK, Artist, TrackRevision

from ._helpers import OWNER_DID, TRACK_URI, make_track


def _add_revision(
    track_id: int,
    *,
    file_id: str,
    file_type: str = "mp3",
    audio_storage: str = "r2",
    audio_url: str | None = None,
    was_gated: bool = False,
    duration: int | None = 120,
    original_file_id: str | None = None,
) -> TrackRevision:
    """build (but don't add) a TrackRevision row."""
    return TrackRevision(
        track_id=track_id,
        file_id=file_id,
        file_type=file_type,
        original_file_id=original_file_id,
        original_file_type=None,
        audio_storage=audio_storage,
        audio_url=audio_url or f"https://audio.example/{file_id}.{file_type}",
        pds_blob_cid=None,
        pds_blob_size=None,
        duration=duration,
        was_gated=was_gated,
    )


class TestPruneRevisions:
    """verify retention cap + blob deletion behavior."""

    async def test_under_cap_is_a_noop(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        track = make_track()
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        for i in range(3):
            db_session.add(_add_revision(track.id, file_id=f"REV-{i}"))
        await db_session.commit()

        with patch(
            "backend._internal.track_revisions.storage.delete",
            AsyncMock(return_value=True),
        ) as mock_delete:
            await prune_revisions(track.id)

        # nothing was pruned; nothing was deleted
        revisions = (
            (
                await db_session.execute(
                    select(TrackRevision).where(TrackRevision.track_id == track.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(revisions) == 3
        mock_delete.assert_not_called()

    async def test_over_cap_drops_oldest_and_deletes_blob(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        from datetime import UTC, datetime, timedelta

        track = make_track()
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        # write MAX+2 revisions with deterministic created_at ordering
        base = datetime(2026, 1, 1, tzinfo=UTC)
        for i in range(MAX_REVISIONS_PER_TRACK + 2):
            r = _add_revision(track.id, file_id=f"REV-{i:02d}")
            r.created_at = base + timedelta(hours=i)
            db_session.add(r)
        await db_session.commit()

        with patch(
            "backend._internal.track_revisions.storage.delete",
            AsyncMock(return_value=True),
        ) as mock_delete:
            await prune_revisions(track.id)

        # exactly MAX remain; the two oldest are gone
        remaining = (
            (
                await db_session.execute(
                    select(TrackRevision.file_id)
                    .where(TrackRevision.track_id == track.id)
                    .order_by(TrackRevision.created_at.asc())
                )
            )
            .scalars()
            .all()
        )
        assert len(remaining) == MAX_REVISIONS_PER_TRACK
        assert "REV-00" not in remaining
        assert "REV-01" not in remaining
        assert "REV-02" in remaining

        # blobs for the two pruned revisions were deleted
        deleted_keys = {call.args[0] for call in mock_delete.call_args_list}
        assert "REV-00" in deleted_keys
        assert "REV-01" in deleted_keys

    async def test_does_not_delete_blob_still_referenced_by_track(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        """if track.file_id matches an oldest revision's file_id (e.g. a
        restore made them share content), pruning must NOT delete the blob."""
        from datetime import UTC, datetime, timedelta

        track = make_track(file_id="SHARED")
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        base = datetime(2026, 1, 1, tzinfo=UTC)
        # oldest revision shares file_id with track.file_id
        r0 = _add_revision(track.id, file_id="SHARED")
        r0.created_at = base
        db_session.add(r0)
        for i in range(1, MAX_REVISIONS_PER_TRACK + 1):
            r = _add_revision(track.id, file_id=f"REV-{i:02d}")
            r.created_at = base + timedelta(hours=i)
            db_session.add(r)
        await db_session.commit()

        with patch(
            "backend._internal.track_revisions.storage.delete",
            AsyncMock(return_value=True),
        ) as mock_delete:
            await prune_revisions(track.id)

        # SHARED revision row was pruned, but the blob is still in use
        assert mock_delete.call_count == 0

    async def test_pds_only_revision_blob_is_not_deleted(
        self, db_session: AsyncSession, owner: Artist
    ) -> None:
        """audio_storage='pds' means the blob lives on the user's PDS — we
        never delete those, only the row."""
        from datetime import UTC, datetime, timedelta

        track = make_track()
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        base = datetime(2026, 1, 1, tzinfo=UTC)
        r0 = _add_revision(track.id, file_id="PDS-ONLY", audio_storage="pds")
        r0.created_at = base
        db_session.add(r0)
        for i in range(1, MAX_REVISIONS_PER_TRACK + 1):
            r = _add_revision(track.id, file_id=f"REV-{i:02d}")
            r.created_at = base + timedelta(hours=i)
            db_session.add(r)
        await db_session.commit()

        with patch(
            "backend._internal.track_revisions.storage.delete",
            AsyncMock(return_value=True),
        ) as mock_delete:
            await prune_revisions(track.id)

        # PDS-only revision was pruned (row gone) but no blob deletion attempted
        for call in mock_delete.call_args_list:
            assert call.args[0] != "PDS-ONLY"


class TestListRevisionsEndpoint:
    """GET /tracks/{id}/revisions"""

    async def test_returns_history_newest_first(
        self,
        test_app_owner: FastAPI,
        db_session: AsyncSession,
        owner: Artist,
    ) -> None:
        from datetime import UTC, datetime, timedelta

        track = make_track()
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        base = datetime(2026, 1, 1, tzinfo=UTC)
        for i in range(3):
            r = _add_revision(track.id, file_id=f"REV-{i}", duration=100 + i)
            r.created_at = base + timedelta(hours=i)
            db_session.add(r)
        await db_session.commit()

        async with AsyncClient(
            transport=ASGITransport(app=test_app_owner), base_url="http://test"
        ) as client:
            resp = await client.get(f"/tracks/{track.id}/revisions")

        assert resp.status_code == 200
        body = resp.json()
        assert body["track_id"] == track.id
        assert len(body["revisions"]) == 3
        # newest-first
        durations = [r["duration"] for r in body["revisions"]]
        assert durations == [102, 101, 100]
        # response shape
        assert "audio_url" not in body["revisions"][0]  # not exposed
        assert "file_id" not in body["revisions"][0]  # internal
        assert body["revisions"][0]["file_type"] == "mp3"
        assert body["revisions"][0]["was_gated"] is False

    async def test_403_when_not_owner(
        self,
        test_app_other: FastAPI,
        db_session: AsyncSession,
        owner: Artist,
        other_artist: Artist,
    ) -> None:
        track = make_track()
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        async with AsyncClient(
            transport=ASGITransport(app=test_app_other), base_url="http://test"
        ) as client:
            resp = await client.get(f"/tracks/{track.id}/revisions")
        assert resp.status_code == 403

    async def test_404_when_track_missing(
        self, test_app_owner: FastAPI, owner: Artist
    ) -> None:
        async with AsyncClient(
            transport=ASGITransport(app=test_app_owner), base_url="http://test"
        ) as client:
            resp = await client.get("/tracks/999999/revisions")
        assert resp.status_code == 404


class TestRestoreEndpoint:
    """POST /tracks/{id}/revisions/{revision_id}/restore"""

    async def test_restore_swaps_audio_and_publishes_record(
        self,
        test_app_owner: FastAPI,
        db_session: AsyncSession,
        owner: Artist,
    ) -> None:
        track = make_track(file_id="CURRENT", duration=200)
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        revision = _add_revision(track.id, file_id="OLD", duration=120)
        db_session.add(revision)
        await db_session.commit()
        await db_session.refresh(revision)
        original_revision_id = revision.id  # snapshot before session expires
        track_id = track.id

        with patch(
            "backend.api.tracks.revisions.update_record",
            AsyncMock(return_value=(TRACK_URI, "bafyRESTORED")),
        ) as mock_update:
            async with AsyncClient(
                transport=ASGITransport(app=test_app_owner), base_url="http://test"
            ) as client:
                resp = await client.post(
                    f"/tracks/{track_id}/revisions/{original_revision_id}/restore"
                )

        assert resp.status_code == 200
        mock_update.assert_called_once()

        # track now points at the restored audio
        await db_session.refresh(track)
        assert track.file_id == "OLD"
        assert track.atproto_record_cid == "bafyRESTORED"
        assert track.extra["duration"] == 120

        # the chosen revision row was deleted (its content is now current).
        # expire the session so the SELECT goes to the DB rather than the
        # identity map (the endpoint commits via its own session).
        db_session.expire_all()
        revisions_after = (
            (
                await db_session.execute(
                    select(TrackRevision).where(TrackRevision.track_id == track_id)
                )
            )
            .scalars()
            .all()
        )

        revision_ids = [r.id for r in revisions_after]
        assert original_revision_id not in revision_ids

        # exactly one revision remains: the snapshot of the displaced current
        assert len(revisions_after) == 1
        assert revisions_after[0].file_id == "CURRENT"
        assert revisions_after[0].duration == 200

    async def test_409_when_gating_mismatches(
        self,
        test_app_owner: FastAPI,
        db_session: AsyncSession,
        owner: Artist,
    ) -> None:
        """restore is rejected when it would cross the public ↔ gated
        boundary — moving blobs between buckets isn't built yet."""
        # current state: gated. revision: was public.
        track = make_track(file_id="GATED-NEW", support_gate={"type": "any"})
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        revision = _add_revision(track.id, file_id="OLD-PUBLIC", was_gated=False)
        db_session.add(revision)
        await db_session.commit()
        await db_session.refresh(revision)

        async with AsyncClient(
            transport=ASGITransport(app=test_app_owner), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"/tracks/{track.id}/revisions/{revision.id}/restore"
            )
        assert resp.status_code == 409

        # track is unchanged
        await db_session.refresh(track)
        assert track.file_id == "GATED-NEW"

    async def test_404_when_revision_belongs_to_different_track(
        self,
        test_app_owner: FastAPI,
        db_session: AsyncSession,
        owner: Artist,
    ) -> None:
        track_a = make_track(file_id="A")
        track_b = make_track(file_id="B")
        db_session.add_all([track_a, track_b])
        await db_session.commit()
        await db_session.refresh(track_a)
        await db_session.refresh(track_b)

        revision = _add_revision(track_b.id, file_id="REV-B")
        db_session.add(revision)
        await db_session.commit()
        await db_session.refresh(revision)

        async with AsyncClient(
            transport=ASGITransport(app=test_app_owner), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"/tracks/{track_a.id}/revisions/{revision.id}/restore"
            )
        assert resp.status_code == 404

    async def test_403_when_not_owner(
        self,
        test_app_other: FastAPI,
        db_session: AsyncSession,
        owner: Artist,
        other_artist: Artist,
    ) -> None:
        track = make_track()
        db_session.add(track)
        await db_session.commit()
        await db_session.refresh(track)

        revision = _add_revision(track.id, file_id="OLD")
        db_session.add(revision)
        await db_session.commit()
        await db_session.refresh(revision)

        async with AsyncClient(
            transport=ASGITransport(app=test_app_other), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"/tracks/{track.id}/revisions/{revision.id}/restore"
            )
        assert resp.status_code == 403


# OWNER_DID is imported but unused in this file's body; the test_app_*
# fixtures use it implicitly via MockSession. silence ruff with a no-op ref.
_ = OWNER_DID
