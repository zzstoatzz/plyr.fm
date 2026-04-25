"""regression: pds_create_like writes a tombstone when its row was unliked.

paired with `TestIngestLikeCreate.test_skips_create_for_cancelled_uri` —
together they cover both halves of the unlike-while-pending race fix:

- this file: tombstone IS written by `pds_create_like` when the optimistic
  TrackLike row no longer exists at the time the PDS create completes
  (i.e. the user unliked between handler-return and worker-execution).
- ingest test: `ingest_like_create` reads the tombstone and drops the
  matching create event so the row is not resurrected.

without both halves, the race in `test_cross_user_like` (integration
suite) returns: PDS-create completes, Jetstream emits a create event,
ingest re-inserts the row that the user already cancelled.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.tasks.pds import (
    LIKE_CANCELLED_TOMBSTONE_PREFIX,
    LIKE_CANCELLED_TOMBSTONE_TTL_SECONDS,
    pds_create_like,
)
from backend.models import Artist, Track


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    """test artist with a unique DID (xdist-safe)."""
    a = Artist(
        did=f"did:plc:liketomb_{uuid.uuid4().hex[:12]}",
        handle="liketomb.test",
        display_name="Like Tombstone Test",
        pds_url="https://bsky.social",
    )
    db_session.add(a)
    await db_session.commit()
    return a


@pytest.fixture
async def track(db_session: AsyncSession, artist: Artist) -> Track:
    """test track owned by `artist`."""
    t = Track(
        title="liketomb track",
        file_id=f"file_{uuid.uuid4().hex[:12]}",
        file_type="mp3",
        artist_did=artist.did,
        r2_url="https://r2.example.com/liketomb.mp3",
        atproto_record_uri=f"at://{artist.did}/fm.plyr.track/liketomb",
        atproto_record_cid="bafyliketomb",
        audio_storage="r2",
    )
    db_session.add(t)
    await db_session.commit()
    return t


def _mock_redis() -> tuple[AsyncMock, dict[str, str]]:
    """in-memory redis double that records SETs so we can assert TTL + ordering."""
    store: dict[str, str] = {}
    set_calls: list[tuple[str, str, int | None]] = []

    async def fake_set(key: str, value: str, ex: int | None = None) -> None:
        store[key] = value
        set_calls.append((key, value, ex))

    async def fake_exists(key: str) -> int:
        return 1 if key in store else 0

    mock = AsyncMock()
    mock.set = AsyncMock(side_effect=fake_set)
    mock.exists = AsyncMock(side_effect=fake_exists)
    mock._set_calls = set_calls
    return mock, store


class TestPdsCreateLikeTombstones:
    """`pds_create_like` writes a tombstone before issuing the orphan PDS
    delete, so a still-in-flight Jetstream create event for the same URI
    is recognized as already-cancelled in `ingest_like_create`."""

    async def test_writes_tombstone_when_local_row_already_unliked(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """if the optimistic TrackLike row is gone by the time PDS create
        returns, tombstone the URI BEFORE calling delete_record_by_uri."""
        # no row in the DB — user already unliked.
        nonexistent_like_id = 99999999
        created_uri = "at://did:plc:test/fm.plyr.like/cancelled-uri"

        mock_redis, store = _mock_redis()
        delete_call_args: list[str] = []

        async def fake_delete_by_uri(_session: object, uri: str) -> None:
            delete_call_args.append(uri)

        with (
            patch(
                "backend._internal.tasks.pds.get_session",
                return_value=AsyncMock(did=artist.did),
            ),
            patch(
                "backend._internal.tasks.pds.create_like_record",
                return_value=created_uri,
            ),
            patch(
                "backend._internal.tasks.pds.delete_record_by_uri",
                side_effect=fake_delete_by_uri,
            ),
            patch(
                "backend._internal.tasks.pds.get_async_redis_client",
                return_value=mock_redis,
            ),
        ):
            await pds_create_like(
                session_id="any-session",
                like_id=nonexistent_like_id,
                subject_uri=track.atproto_record_uri or "at://did/track/1",
                subject_cid=track.atproto_record_cid or "bafy",
            )

        # tombstone is keyed by URI under the documented prefix, with the
        # documented TTL — these constants are the contract `ingest.py`
        # imports against, so a future drift breaks both halves at once.
        tombstone_key = f"{LIKE_CANCELLED_TOMBSTONE_PREFIX}{created_uri}"
        assert tombstone_key in store
        ((called_key, _, ttl),) = mock_redis._set_calls
        assert called_key == tombstone_key
        assert ttl == LIKE_CANCELLED_TOMBSTONE_TTL_SECONDS

        # and the orphan PDS delete still fires (the tombstone closes the
        # ingest race; the actual PDS record still has to be removed).
        assert delete_call_args == [created_uri]

    async def test_no_tombstone_on_happy_path(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """the tombstone path is *only* for the orphan-cleanup branch; a
        normal PDS create that finds its local row should not pollute
        Redis with a tombstone (which would suppress the user's own
        Jetstream create event and stall the like indefinitely)."""
        from backend.models import TrackLike

        like = TrackLike(track_id=track.id, user_did=artist.did, atproto_like_uri=None)
        db_session.add(like)
        await db_session.commit()
        await db_session.refresh(like)

        mock_redis, store = _mock_redis()

        with (
            patch(
                "backend._internal.tasks.pds.get_session",
                return_value=AsyncMock(did=artist.did),
            ),
            patch(
                "backend._internal.tasks.pds.create_like_record",
                return_value="at://did:plc:test/fm.plyr.like/happy",
            ),
            patch(
                "backend._internal.tasks.pds.delete_record_by_uri",
                new_callable=AsyncMock,
            ) as mock_delete,
            patch(
                "backend._internal.tasks.pds.get_async_redis_client",
                return_value=mock_redis,
            ),
        ):
            await pds_create_like(
                session_id="any-session",
                like_id=like.id,
                subject_uri=track.atproto_record_uri or "at://did/track/1",
                subject_cid=track.atproto_record_cid or "bafy",
            )

        assert store == {}, (
            "happy-path PDS create must not write a tombstone "
            "(would suppress the user's own Jetstream create event)"
        )
        mock_delete.assert_not_called()
