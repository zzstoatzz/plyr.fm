"""regression for issue #1444 — editing a track must sync to ATProto.

`PATCH /tracks/{id}` rebuilds the track's PDS record after a metadata change.
`beartype_this_package()` runtime-checks every function, and
`rebuild_track_pds_record` was annotated `track: "Track"` with `Track` imported
only under `TYPE_CHECKING`, so the rebuild raised
`BeartypeCallHintForwardRefException` → `db.rollback()` → 500
("failed to sync track update to ATProto"). the edit was lost.

the existing edit coverage (`test_track_deletion.test_edit_same_image_does_not_delete`)
mocks `rebuild_track_pds_record` away, so it never exercised the annotation.
this test lets the real rebuild run and mocks only the PDS HTTP boundary.
"""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Artist, Track

_ARTIST_DID = "did:plc:edit_sync_artist"


class MockSession(Session):
    def __init__(self, did: str = _ARTIST_DID) -> None:
        self.did = did
        self.handle = "editor.bsky.social"
        self.session_id = "test_session_id"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": "editor.bsky.social",
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    async def mock_require_auth() -> Session:
        return MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth
    yield app
    app.dependency_overrides.pop(require_auth, None)


@pytest.fixture
async def published_track(db_session: AsyncSession) -> Track:
    """a public track that already has a PDS record (so the edit triggers a rebuild)."""
    artist = Artist(did=_ARTIST_DID, handle="editor.bsky.social", display_name="Editor")
    db_session.add(artist)
    await db_session.flush()
    track = Track(
        title="original title",
        artist_did=_ARTIST_DID,
        file_id="edit_sync_file",
        file_type="mp3",
        extra={"duration": 180},
        r2_url="https://audio.example.com/edit_sync_file.mp3",
        atproto_record_uri=f"at://{_ARTIST_DID}/fm.plyr.track/editsync",
        atproto_record_cid="bafyoriginal",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    return track


async def test_editing_track_title_syncs_to_pds(
    test_app: FastAPI, db_session: AsyncSession, published_track: Track
) -> None:
    # mock only the PDS network call; rebuild_track_pds_record + build_track_record
    # + update_record all run for real (and through beartype).
    pds = AsyncMock(
        return_value={"uri": published_track.atproto_record_uri, "cid": "bafyupdated"}
    )
    with patch("backend._internal.atproto.records.fm_plyr.track.make_pds_request", pds):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.patch(
                f"/tracks/{published_track.id}", data={"title": "renamed track"}
            )

    # with the #1444 bug this was a 500 from the beartype forward-ref error
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "renamed track"

    # the rebuild reached putRecord, carrying the new title
    pds.assert_awaited_once()
    assert pds.await_args is not None
    _auth, method, nsid, payload = pds.await_args.args
    assert (method, nsid) == ("POST", "com.atproto.repo.putRecord")
    assert payload["record"]["title"] == "renamed track"

    # and the edit persisted (no rollback)
    await db_session.refresh(published_track)
    assert published_track.title == "renamed track"


async def test_editing_creator_self_label_syncs_to_pds(
    test_app: FastAPI, db_session: AsyncSession, published_track: Track
) -> None:
    pds = AsyncMock(
        return_value={"uri": published_track.atproto_record_uri, "cid": "bafylabels"}
    )
    with patch("backend._internal.atproto.records.fm_plyr.track.make_pds_request", pds):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.patch(
                f"/tracks/{published_track.id}",
                data={"self_labels": '["sexual"]'},
            )

    assert response.status_code == 200, response.text
    assert response.json()["self_labels"] == ["sexual"]
    assert response.json()["labels"] == ["sexual"]
    assert pds.await_args is not None
    record = pds.await_args.args[3]["record"]
    assert record["labels"] == {
        "$type": "com.atproto.label.defs#selfLabels",
        "values": [{"val": "sexual"}],
    }

    await db_session.refresh(published_track)
    assert published_track.self_labels == ["sexual"]
