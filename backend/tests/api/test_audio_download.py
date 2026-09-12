"""tests for the audio download endpoint."""

import subprocess
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import get_optional_session
from backend.main import app
from backend.models import Artist, CopyrightScan, Track, UserPreferences
from backend.schemas import TrackResponse
from backend.storage.r2 import content_disposition
from backend.utilities.downloads import download_filename
from tests.api.track_audio_replace._helpers import MockSession


@pytest.fixture
def test_app() -> FastAPI:
    return app


async def _make_track(db_session: AsyncSession, **overrides) -> Track:
    artist = Artist(
        did=overrides.pop("artist_did", "did:plc:dlartist"),
        handle="dlartist.bsky.social",
        display_name="Download Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    fields = {
        "title": "My Song",
        "artist_did": artist.did,
        "file_id": "aabbccddeeff0011",
        "file_type": "mp3",
    } | overrides
    track = Track(**fields)
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    return track


async def _download(test_app: FastAPI, file_id: str):
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        return await client.get(f"/audio/{file_id}/download", follow_redirects=False)


async def test_download_public_track_redirects_with_filename(
    test_app: FastAPI, db_session: AsyncSession
):
    track = await _make_track(db_session)

    mock_storage = MagicMock()
    mock_storage.generate_download_url = AsyncMock(
        return_value="https://r2.example.com/signed"
    )

    with patch("backend.api.audio.storage", mock_storage):
        response = await _download(test_app, track.file_id)

    assert response.status_code == 307
    assert response.headers["location"] == "https://r2.example.com/signed"
    mock_storage.generate_download_url.assert_awaited_once_with(
        key="audio/aabbccddeeff0011.mp3",
        filename="Download Artist - My Song.mp3",
        private=False,
    )


async def test_download_prefers_lossless_original(
    test_app: FastAPI, db_session: AsyncSession
):
    track = await _make_track(
        db_session,
        original_file_id="ccddeeff00112233",
        original_file_type="flac",
    )

    mock_storage = MagicMock()
    mock_storage.generate_download_url = AsyncMock(return_value="https://signed")

    with patch("backend.api.audio.storage", mock_storage):
        response = await _download(test_app, track.file_id)

    assert response.status_code == 307
    mock_storage.generate_download_url.assert_awaited_once_with(
        key="audio/ccddeeff00112233.flac",
        filename="Download Artist - My Song.flac",
        private=False,
    )


@pytest.mark.parametrize("gate_type", ["any", "signed_in"])
async def test_download_refuses_gated_track(
    test_app: FastAPI, db_session: AsyncSession, gate_type: str
) -> None:
    track = await _make_track(
        db_session, support_gate={"type": gate_type}, download_policy="off"
    )
    response = await _download(test_app, track.file_id)
    assert response.status_code == 403


async def test_download_refuses_copyright_labeled_track(
    test_app: FastAPI, db_session: AsyncSession
):
    track = await _make_track(db_session, operator_labels=["copyright-violation"])
    response = await _download(test_app, track.file_id)
    assert response.status_code == 403


async def test_download_allows_copyright_label_with_allow_override(
    test_app: FastAPI, db_session: AsyncSession
):
    track = await _make_track(
        db_session,
        operator_labels=["copyright-violation"],
        moderation_override="allow",
    )

    mock_storage = MagicMock()
    mock_storage.generate_download_url = AsyncMock(return_value="https://signed")

    with patch("backend.api.audio.storage", mock_storage):
        response = await _download(test_app, track.file_id)

    assert response.status_code == 307


async def test_scan_flag_alone_does_not_block_downloads(
    test_app: FastAPI, db_session: AsyncSession
):
    """a fingerprint match is a pending review, not a finding — policy keys on
    the copyright label, matching discovery/radio/streaming (#1697)."""
    track = await _make_track(db_session)
    db_session.add(CopyrightScan(track_id=track.id, is_flagged=True))
    await db_session.commit()

    mock_storage = MagicMock()
    mock_storage.generate_download_url = AsyncMock(return_value="https://signed")

    with patch("backend.api.audio.storage", mock_storage):
        response = await _download(test_app, track.file_id)

    assert response.status_code == 307
    assert (await _response_for(db_session, track.id)).downloadable is True


async def test_download_refuses_when_artist_disabled_downloads(
    test_app: FastAPI, db_session: AsyncSession
):
    track = await _make_track(db_session)
    track.download_policy = "off"
    await db_session.commit()

    response = await _download(test_app, track.file_id)
    assert response.status_code == 403
    assert "disabled downloads" in response.json()["detail"]


async def test_download_refuses_private_track(
    test_app: FastAPI, db_session: AsyncSession
):
    track = await _make_track(
        db_session,
        visibility="private",
        space_uri="at://did:plc:dlartist/space/media/abc",
    )
    response = await _download(test_app, track.file_id)
    assert response.status_code == 404


async def test_download_unknown_file_404(test_app: FastAPI, db_session: AsyncSession):
    response = await _download(test_app, "nope-not-real")
    assert response.status_code == 404


def test_download_filename_sanitizes():
    assert download_filename("A/B", 'so:ng "quoted"', "mp3") == "AB - song quoted.mp3"
    assert download_filename("", "solo", "flac") == "solo.flac"
    assert download_filename("x", "...", "mp3") == "x -.mp3"


def test_content_disposition_carries_unicode():
    value = content_disposition("héllo.mp3")
    assert value.startswith('attachment; filename="h?llo.mp3"')
    assert "filename*=UTF-8''h%C3%A9llo.mp3" in value


async def _response_for(db_session: AsyncSession, track_id: int) -> TrackResponse:
    """rebuild the track through a fresh ORM query, the way endpoints do."""
    db_session.expire_all()
    result = await db_session.execute(
        select(Track)
        .where(Track.id == track_id)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
    )
    return await TrackResponse.from_track(result.scalar_one())


async def test_track_response_downloadable_by_default(
    test_app: FastAPI, db_session: AsyncSession
):
    track = await _make_track(db_session)
    response = await _response_for(db_session, track.id)
    assert response.downloadable is True


async def test_track_response_not_downloadable_when_artist_opted_out(
    test_app: FastAPI, db_session: AsyncSession
):
    track = await _make_track(db_session)
    track.download_policy = "off"
    await db_session.commit()

    response = await _response_for(db_session, track.id)
    assert response.downloadable is False


async def test_track_response_not_downloadable_when_gated_or_labeled(
    test_app: FastAPI, db_session: AsyncSession
):
    gated = await _make_track(
        db_session, support_gate={"type": "any"}, download_policy="off"
    )
    labeled = await _make_track(
        db_session,
        artist_did="did:plc:dlartist2",
        file_id="aabbccddeeff0022",
        operator_labels=["copyright-violation"],
    )
    gated_id, labeled_id = gated.id, labeled.id

    assert (await _response_for(db_session, gated_id)).downloadable is False
    assert (await _response_for(db_session, labeled_id)).downloadable is False


async def test_download_refuses_when_no_object_is_ours_to_serve(
    test_app: FastAPI, db_session: AsyncSession
):
    """pds-only rows and unmirrored ingested rows must 404, not 307 to a
    presigned URL for a key that names nothing (NoSuchKey error body)."""
    pds_only = await _make_track(
        db_session,
        audio_storage="pds",
        pds_blob_cid="bafyfake",
    )
    ingested = await _make_track(
        db_session,
        artist_did="did:plc:dlartist3",
        file_id="3jzfcijpj2z2a",  # a record rkey, not our content hash
        r2_url="https://someone-elses.example.com/audio/whatever.mp3",
    )
    pds_only_id, ingested_id = pds_only.id, ingested.id

    for track in (pds_only, ingested):
        response = await _download(test_app, track.file_id)
        assert response.status_code == 404

    assert (await _response_for(db_session, pds_only_id)).downloadable is False
    assert (await _response_for(db_session, ingested_id)).downloadable is False


@pytest.mark.timeout(60)
def test_app_imports_in_production_order():
    """main.py's import order must not hit a circular import.

    the 2026-08-13 staging outage: schemas -> utilities.downloads ->
    storage.keys triggers storage/__init__ -> r2, which re-entered the
    partially initialized downloads module. only reproducible in a fresh
    interpreter that imports backend.main first, the way uvicorn does.
    """
    result = subprocess.run(
        [sys.executable, "-c", "import backend.main"],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr


async def test_supporters_policy_requires_sign_in(
    test_app: FastAPI, db_session: AsyncSession
):
    track = await _make_track(db_session)
    track.download_policy = "supporters"
    await db_session.commit()

    response = await _download(test_app, track.file_id)
    assert response.status_code == 401

    resp = await _response_for(db_session, track.id)
    assert resp.downloadable is False
    assert resp.download_policy == "supporters"


async def test_support_link_does_not_change_published_policy(
    test_app: FastAPI, db_session: AsyncSession
):
    """Adding a support link does not mutate a published download policy."""
    track = await _make_track(db_session)
    db_session.add(
        UserPreferences(did=track.artist_did, support_url="https://ko-fi.example")
    )
    await db_session.commit()

    mock_storage = MagicMock()
    mock_storage.generate_download_url = AsyncMock(return_value="https://signed")
    with patch("backend.api.audio.storage", mock_storage):
        response = await _download(test_app, track.file_id)
    assert response.status_code == 307

    resp = await _response_for(db_session, track.id)
    assert resp.downloadable is True
    assert resp.download_policy == "open"
    assert resp.artist_support_url == "https://ko-fi.example"


async def test_no_support_link_defaults_policy_to_open(
    test_app: FastAPI, db_session: AsyncSession
):
    track = await _make_track(db_session)
    resp = await _response_for(db_session, track.id)
    assert resp.downloadable is True
    assert resp.download_policy == "open"


async def test_stream_track_is_playable_but_not_downloadable(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    track = await _make_track(
        db_session, audio_storage="r2_private", download_policy="off"
    )
    response = await _response_for(db_session, track.id)
    assert response.visibility == "public"
    assert response.gated is False
    assert response.downloadable is False


@pytest.mark.parametrize("path", ["", "/url", "/download"])
async def test_protected_master_is_not_public_playback(
    test_app: FastAPI, db_session: AsyncSession, path: str
) -> None:
    track = await _make_track(
        db_session,
        audio_storage="r2_private",
        download_policy="off",
        original_file_id="ccddeeff00112233",
        original_file_type="flac",
    )
    with (
        patch(
            "backend.api.audio.storage.get_url",
            AsyncMock(return_value="https://public.test/master"),
        ),
        patch(
            "backend.api.audio.storage.generate_download_url",
            AsyncMock(return_value="https://private.test/master"),
        ),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(f"/audio/{track.original_file_id}{path}")
    assert response.status_code == 403


async def test_artist_recovers_protected_original(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    track = await _make_track(
        db_session,
        audio_storage="r2_private",
        download_policy="off",
        original_file_id="ccddeeff00112233",
        original_file_type="flac",
    )
    test_app.dependency_overrides[get_optional_session] = lambda: MockSession(
        track.artist_did
    )
    try:
        with patch(
            "backend.api.audio.storage.generate_download_url",
            AsyncMock(return_value="https://private.test/original"),
        ) as sign:
            response = await _download(test_app, track.file_id)
        assert response.status_code == 307
        sign.assert_awaited_once_with(
            key="audio/ccddeeff00112233.flac",
            filename="Download Artist - My Song.flac",
            private=True,
        )
    finally:
        test_app.dependency_overrides.pop(get_optional_session, None)


@pytest.mark.parametrize(
    "override,artist_policy,allowed",
    [("open", "off", True), ("off", "open", False), ("supporters", "open", False)],
)
async def test_track_download_policy_overrides_artist_default(
    test_app: FastAPI,
    db_session: AsyncSession,
    override: str,
    artist_policy: str,
    allowed: bool,
) -> None:
    track = await _make_track(
        db_session, audio_storage="r2_private", download_policy=override
    )
    db_session.add(
        UserPreferences(
            did=track.artist_did,
            publishing_defaults={"access": {"downloads": artist_policy}},
        )
    )
    await db_session.commit()
    with patch(
        "backend.api.audio.storage.generate_download_url",
        AsyncMock(return_value="https://private.test/audio"),
    ):
        response = await _download(test_app, track.file_id)
    metadata = await _response_for(db_session, track.id)
    assert (response.status_code == 307) is allowed
    assert metadata.downloadable is allowed
    assert metadata.gated is False


@pytest.mark.parametrize("is_supporter", [False, True])
async def test_protected_supporter_download_uses_existing_verifier(
    test_app: FastAPI, db_session: AsyncSession, is_supporter: bool
) -> None:
    track = await _make_track(
        db_session, audio_storage="r2_private", download_policy="supporters"
    )
    test_app.dependency_overrides[get_optional_session] = lambda: MockSession(
        "did:plc:listener"
    )
    try:
        with (
            patch(
                "backend.api.audio.validate_supporter",
                AsyncMock(return_value=MagicMock(valid=is_supporter)),
            ),
            patch(
                "backend.api.audio.storage.generate_download_url",
                AsyncMock(return_value="https://private.test/audio"),
            ) as sign,
        ):
            response = await _download(test_app, track.file_id)
        assert response.status_code == (307 if is_supporter else 403)
        assert sign.await_count == int(is_supporter)
        if is_supporter:
            assert sign.call_args.kwargs["private"] is True
    finally:
        test_app.dependency_overrides.pop(get_optional_session, None)
