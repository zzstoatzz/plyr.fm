"""upload-endpoint preflight gating for private (permissioned-space) media (#1528).

these assertions all trip BEFORE any audio staging / docket enqueue, so they
exercise the real endpoint gating without the full pipeline. the end-to-end space
write/read is covered against a live ZDS by scripts/permissioned_smoke.py.
"""

from collections.abc import Generator
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_artist_profile
from backend._internal.audio import AudioFormat
from backend.config import settings
from backend.main import app

# the granted token carries the expanded space scope (what the preflight checks for),
# not the requested `include:` form
_TYPE = settings.atproto.private_media_space_type
PERM_SCOPE = f"space:{_TYPE}?action=create&did=*&skey=self&collection={_TYPE}"


class _MockSession(Session):
    def __init__(
        self, *, with_space_scope: bool = False, app_password: bool = False
    ) -> None:
        self.did = "did:test:artist"
        self.handle = "artist.test"
        self.session_id = "test_session_private_media"
        scopes = ["atproto", "transition:generic"]
        if with_space_scope:
            scopes.append(PERM_SCOPE)
        self.oauth_session = {
            "did": self.did,
            "handle": self.handle,
            "pds_url": "https://test.pds",
            "scope": " ".join(scopes),
            "access_token": "t",
            "refresh_token": "r",
            "dpop_private_key_pem": "fake",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }
        if app_password:
            self.oauth_session["auth_type"] = "app_password"


def _auth_app(*, with_space_scope: bool) -> Generator[FastAPI, None, None]:
    async def _profile() -> Session:
        return _MockSession(with_space_scope=with_space_scope)

    app.dependency_overrides[require_artist_profile] = _profile
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def app_no_scope(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    yield from _auth_app(with_space_scope=False)


@pytest.fixture
def app_with_scope(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    yield from _auth_app(with_space_scope=True)


# minimal RIFF/WAVE header — web-playable; enough to pass extension routing
_WAV = b"RIFF\x24\x00\x00\x00WAVEfmt private-media-test"


def _post(client: TestClient, *, filename: str = "t.wav", data: dict) -> httpx.Response:
    return client.post(
        "/tracks/",
        files={"file": (filename, _WAV, "audio/wav")},
        data={"title": "private test", **data},
    )


def test_private_requires_pds_capability(app_no_scope: FastAPI):
    with (
        patch(
            "backend.api.tracks.uploads.detect_permissioned_capability",
            return_value=False,
        ),
        TestClient(app_no_scope) as client,
    ):
        resp = _post(client, data={"visibility": "private"})
    assert resp.status_code == 400
    assert "permissioned spaces" in resp.json()["detail"]


def test_private_capable_but_scope_missing_requests_upgrade(app_no_scope: FastAPI):
    with (
        patch(
            "backend.api.tracks.uploads.detect_permissioned_capability",
            return_value=True,
        ),
        TestClient(app_no_scope) as client,
    ):
        resp = _post(client, data={"visibility": "private"})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "permissioned_scope_required"


def test_private_app_password_session_bypasses_oauth_scope_gate(
    app_no_scope: FastAPI,
) -> None:
    async def _profile() -> Session:
        return _MockSession(app_password=True)

    app_no_scope.dependency_overrides[require_artist_profile] = _profile
    fake_blob = {
        "$type": "blob",
        "ref": {"$link": "bafkreiappassword"},
        "mimeType": "audio/wav",
        "size": len(_WAV),
    }

    with (
        patch(
            "backend.api.tracks.uploads.detect_permissioned_capability",
            return_value=True,
        ),
        patch("backend.api.tracks.uploads.upload_blob", return_value=fake_blob),
        patch("backend.api.tracks.uploads.schedule_track_upload"),
        TestClient(app_no_scope) as client,
    ):
        resp = _post(client, data={"visibility": "private"})

    assert resp.status_code == 200, resp.text


def test_private_rejects_non_web_playable(app_with_scope: FastAPI):
    with (
        patch(
            "backend.api.tracks.uploads.detect_permissioned_capability",
            return_value=True,
        ),
        TestClient(app_with_scope) as client,
    ):
        resp = client.post(
            "/tracks/",
            files={"file": ("t.aiff", _WAV, "audio/aiff")},
            data={"title": "x", "visibility": "private"},
        )
    assert resp.status_code == 400
    assert "web-playable" in resp.json()["detail"]


def test_private_and_copyright_mutually_exclusive(app_with_scope: FastAPI):
    # visibility=private can't combine with the orthogonal copyright gate
    with TestClient(app_with_scope) as client:
        resp = _post(
            client,
            data={"visibility": "private", "copyright": '{"iswc": "T-000.000.001-0"}'},
        )
    assert resp.status_code == 400
    assert "copyright cannot combine" in resp.json()["detail"]


# --- success path: private upload goes to the PDS, never R2 (regression) ------


def test_private_upload_goes_to_pds_not_r2(app_with_scope: FastAPI):
    """a capable+scoped private upload must call uploadBlob, never stage to R2,
    and carry the resulting BlobRef on the enqueued context."""
    fake_blob = {
        "$type": "blob",
        "ref": {"$link": "bafkreiprivatesmoke"},
        "mimeType": "audio/wav",
        "size": len(_WAV),
    }
    captured: dict = {}

    async def _fake_upload_blob(*args, **kwargs):
        return fake_blob

    async def _fake_schedule(ctx):
        captured["ctx"] = ctx

    async def _no_stage(*args, **kwargs):  # must NOT be called for private
        raise AssertionError("private upload must not stage audio to R2")

    with (
        patch(
            "backend.api.tracks.uploads.detect_permissioned_capability",
            return_value=True,
        ),
        patch("backend.api.tracks.uploads.upload_blob", _fake_upload_blob),
        patch("backend.api.tracks.uploads.stage_audio_to_storage", _no_stage),
        patch("backend.api.tracks.uploads.schedule_track_upload", _fake_schedule),
        TestClient(app_with_scope) as client,
    ):
        resp = _post(client, data={"visibility": "private"})

    assert resp.status_code == 200, resp.text
    ctx = captured["ctx"]
    # the BlobRef from the PDS upload rode through to the worker context
    assert ctx.visibility == "private"
    assert ctx.audio_blob == fake_blob
    assert ctx.private is True


async def test_upload_to_pds_reuses_handler_blob_for_private(monkeypatch):
    """worker phase 4: private uploads return the handler's BlobRef without
    touching R2 (no head_file / stream_file_data)."""
    from backend.api.tracks import uploads as up
    from backend.storage import storage

    blob = {"$type": "blob", "ref": {"$link": "bafkreiabc"}, "size": 99}
    ctx = up.UploadContext(
        upload_id="u",
        auth_session=_MockSession(with_space_scope=True),
        audio_file_id="hash16",
        filename="t.wav",
        duration=1,
        title="x",
        artist_did="did:test:artist",
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
        visibility="private",
        audio_blob=blob,
    )
    info = up.AudioInfo(
        format=AudioFormat.MP3, duration=1, is_gated=False, is_private=True
    )
    sr = up.StorageResult(
        file_id="hash16",
        original_file_id=None,
        original_file_type=None,
        playable_format=AudioFormat.MP3,
        r2_url=None,
        transcode_info=None,
    )

    def _boom(*a, **k):
        raise AssertionError("private must not read audio from R2")

    monkeypatch.setattr(storage, "head_file", _boom)
    monkeypatch.setattr(storage, "stream_file_data", _boom)

    result = await up._upload_to_pds(ctx, info, sr)
    assert result is not None
    assert result.blob_ref == blob
    assert result.cid == "bafkreiabc"


async def test_private_cleanup_never_touches_r2(monkeypatch):
    """regression: private failure-cleanup must NOT call storage.delete. the
    synthetic file_id is a content hash that could collide with a DIFFERENT
    public track's R2 key; private audio lives only as a PDS blob."""
    from backend.api.tracks import uploads as up
    from backend.storage import storage

    ctx = up.UploadContext(
        upload_id="u",
        auth_session=_MockSession(with_space_scope=True),
        audio_file_id="collidinghash16",
        filename="t.wav",
        duration=1,
        title="x",
        artist_did="did:test:artist",
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
        visibility="private",
    )
    sr = up.StorageResult(
        file_id="collidinghash16",
        original_file_id=None,
        original_file_type=None,
        playable_format=AudioFormat.MP3,
        r2_url=None,
        transcode_info=None,
    )

    async def _boom(*a, **k):
        raise AssertionError("private cleanup must not delete from R2")

    monkeypatch.setattr(storage, "delete", _boom)

    # must be a no-op for private (early return), not an R2 delete
    await up._cleanup_staged_media_pre_db(ctx, sr)


def test_private_upload_dead_session_returns_401_not_500(app_with_scope: FastAPI):
    """a dead atproto refresh token during the in-request PDS blob upload must
    surface as 401 session_expired (so the client re-auths), not a 500 that the
    browser shows as a misleading 'connection failed' network error."""
    from backend._internal.atproto.client import SessionExpiredError

    async def _dead_session(*args, **kwargs):
        raise SessionExpiredError(
            "atproto session expired — re-authentication required"
        )

    with (
        patch(
            "backend.api.tracks.uploads.detect_permissioned_capability",
            return_value=True,
        ),
        patch("backend.api.tracks.uploads.upload_blob", _dead_session),
        TestClient(app_with_scope) as client,
    ):
        resp = _post(client, data={"visibility": "private"})

    assert resp.status_code == 401, resp.text
    assert resp.json()["detail"] == "session_expired"
