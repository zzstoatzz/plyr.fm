"""tests for the verified PDS blob mirror (#1778)."""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.tasks.pds_mirror import (
    BlobVerificationError,
    cid_for_blob,
    mirror_pds_blob,
)
from backend.models import Artist, Track

MOCK_FETCH_PATH = "backend._internal.tasks.pds_mirror._fetch_blob"
MOCK_STORAGE_PATH = "backend._internal.tasks.pds_mirror.storage"
MOCK_REENTRY_PATH = "backend._internal.tasks.hooks.run_post_track_create_hooks"

# pinned CIDv1 / raw / sha256 vectors, reproducible by any implementation.
# the encoding was additionally checked end-to-end against a live PDS: the
# 783487-byte blob at pds.zzstoatzz.io for
# bafkreig2lezdhb6ctnljhennnqfy3x66vvdndjjo7nerqji7n3sypm5mca hashed to
# exactly that CID. it is not inlined here for obvious reasons.
_CID_OF_EMPTY = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"
_CID_OF_HELLO_WORLD = "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e"


async def _track_on_pds(
    db: AsyncSession,
    *,
    cid: str,
    pds_url: str = "https://pds.example.com",
) -> Track:
    artist = Artist(
        did="did:plc:mirror_test",
        handle="mirror.test.social",
        display_name="Mirror Artist",
        pds_url=pds_url,
    )
    db.add(artist)
    await db.commit()

    track = Track(
        title="mirrored",
        file_id="notahash",
        file_type="mp3",
        artist_did=artist.did,
        r2_url=None,
        audio_storage="pds",
        pds_blob_cid=cid,
        publish_state="published",
    )
    db.add(track)
    await db.commit()
    return track


class TestCidForBlob:
    def test_matches_known_cid_vectors(self) -> None:
        """the whole guarantee rests on this encoding being the PDS's."""
        assert cid_for_blob(b"") == _CID_OF_EMPTY
        assert cid_for_blob(b"hello world") == _CID_OF_HELLO_WORLD

    def test_distinct_bytes_give_distinct_cids(self) -> None:
        assert cid_for_blob(b"one") != cid_for_blob(b"two")


class TestMirrorPdsBlob:
    async def test_stores_verified_blob_and_flips_storage(
        self, db_session: AsyncSession
    ) -> None:
        audio = b"real audio bytes"
        track = await _track_on_pds(db_session, cid=cid_for_blob(audio))

        storage_mock = AsyncMock()
        storage_mock.save.return_value = "deadbeefdeadbeef"
        storage_mock.get_url.return_value = "https://r2.example.com/audio/x.mp3"

        with (
            patch(MOCK_FETCH_PATH, AsyncMock(return_value=audio)),
            patch(MOCK_STORAGE_PATH, storage_mock),
            patch(MOCK_REENTRY_PATH, AsyncMock()) as reentry,
        ):
            await mirror_pds_blob(track.id)

        await db_session.refresh(track)
        assert track.r2_url == "https://r2.example.com/audio/x.mp3"
        assert track.file_id == "deadbeefdeadbeef"
        assert track.audio_storage == "both"
        # the scans re-run against our copy, without re-notifying followers
        reentry.assert_awaited_once()
        assert reentry.await_args.kwargs["skip_notification"] is True

    async def test_rejects_bytes_that_do_not_match_the_cid(
        self, db_session: AsyncSession
    ) -> None:
        """the case the task exists for: a PDS serving something else.

        the blob URL is fetched fresh on every request, so without this check
        a scanner can be shown clean audio and listeners something else.
        """
        track = await _track_on_pds(db_session, cid=cid_for_blob(b"what was published"))

        storage_mock = AsyncMock()
        with (
            patch(MOCK_FETCH_PATH, AsyncMock(return_value=b"something else entirely")),
            patch(MOCK_STORAGE_PATH, storage_mock),
            pytest.raises(BlobVerificationError),
        ):
            await mirror_pds_blob(track.id)

        storage_mock.save.assert_not_awaited()
        await db_session.refresh(track)
        assert track.r2_url is None
        assert track.audio_storage == "pds"

    async def test_refuses_unsafe_pds_url(self, db_session: AsyncSession) -> None:
        track = await _track_on_pds(
            db_session, cid=cid_for_blob(b"x"), pds_url="http://169.254.169.254"
        )

        with patch(MOCK_FETCH_PATH, AsyncMock()) as fetch:
            await mirror_pds_blob(track.id)

        fetch.assert_not_awaited()

    async def test_skips_track_that_already_has_an_r2_object(
        self, db_session: AsyncSession
    ) -> None:
        track = await _track_on_pds(db_session, cid=cid_for_blob(b"x"))
        track.r2_url = "https://r2.example.com/audio/existing.mp3"
        await db_session.commit()

        with patch(MOCK_FETCH_PATH, AsyncMock()) as fetch:
            await mirror_pds_blob(track.id)

        fetch.assert_not_awaited()

    async def test_unfetchable_blob_leaves_the_track_alone(
        self, db_session: AsyncSession
    ) -> None:
        """a fabricated record names a CID the real PDS will not serve."""
        track = await _track_on_pds(db_session, cid=cid_for_blob(b"x"))

        storage_mock = AsyncMock()
        with (
            patch(MOCK_FETCH_PATH, AsyncMock(return_value=None)),
            patch(MOCK_STORAGE_PATH, storage_mock),
        ):
            await mirror_pds_blob(track.id)

        storage_mock.save.assert_not_awaited()
        await db_session.refresh(track)
        assert track.r2_url is None
