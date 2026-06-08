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
from backend.config import settings
from backend.main import app

# the granted token carries the expanded space scope (what the preflight checks for),
# not the requested `include:` form
_TYPE = settings.atproto.private_media_space_type
PERM_SCOPE = f"space:{_TYPE}?action=create&did=*&skey=self&collection={_TYPE}"


class _MockSession(Session):
    def __init__(self, *, with_space_scope: bool = False) -> None:
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
        resp = _post(client, data={"private": "true"})
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
        resp = _post(client, data={"private": "true"})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "permissioned_scope_required"


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
            data={"title": "x", "private": "true"},
        )
    assert resp.status_code == 400
    assert "web-playable" in resp.json()["detail"]


def test_private_and_gated_mutually_exclusive(app_with_scope: FastAPI):
    # support_gate + private is rejected before any capability check
    with TestClient(app_with_scope) as client:
        resp = _post(
            client, data={"private": "true", "support_gate": '{"type": "any"}'}
        )
    assert resp.status_code == 400
    assert "mutually exclusive" in resp.json()["detail"]
