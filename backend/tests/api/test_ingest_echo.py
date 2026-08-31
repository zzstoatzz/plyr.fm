"""POST /ingest/record — verified read-after-write for client-authored records.

the route must never trust the claimed URI: what gets indexed is what the
caller's PDS actually returns. these tests drive the real endpoint with the
PDS fetch as the only mocked boundary, and assert the invariant the whole
client-writes migration leans on — echo followed by a jetstream replay of the
same event is idempotent in both directions.
"""

from collections.abc import Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.tasks.ingest import ingest_like_create, ingest_like_delete
from backend.config import settings
from backend.models import Artist, Track
from backend.models.track_like import TrackLike

LISTENER_DID = "did:test:listener"
LIKE_COLLECTION = settings.atproto.like_collection


class _ListenerSession(Session):
    def __init__(self) -> None:
        self.did = LISTENER_DID
        self.handle = "listener.test"
        self.session_id = "test_session_ingest_echo"
        self.oauth_session = {
            "did": self.did,
            "handle": self.handle,
            "pds_url": "https://listener.test.pds",
            "scope": "atproto",
            "access_token": "t",
            "refresh_token": "r",
            "dpop_private_key_pem": "fake",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
def listener_app(
    db_session: AsyncSession, fastapi_app: FastAPI
) -> Generator[FastAPI, None, None]:
    async def _session() -> Session:
        return _ListenerSession()

    fastapi_app.dependency_overrides[require_auth] = _session
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
async def track(db_session: AsyncSession) -> Track:
    artist = Artist(did="did:test:artist", handle="artist.test", display_name="artist")
    db_session.add(artist)
    track = Track(
        title="liked track",
        artist_did=artist.did,
        file_id="echo1234",
        file_type="mp3",
        atproto_record_uri="at://did:test:artist/fm.plyr.track/echo1234",
        atproto_record_cid="bafyecho",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    return track


def _like_uri(rkey: str = "3likeecho") -> str:
    return f"at://{LISTENER_DID}/{LIKE_COLLECTION}/{rkey}"


def _like_record(track: Track) -> dict:
    return {
        "$type": LIKE_COLLECTION,
        "subject": {"uri": track.atproto_record_uri, "cid": track.atproto_record_cid},
        "createdAt": "2026-08-31T00:00:00Z",
    }


def _pds_answers(status_code: int, payload: dict | None = None):
    """patch the route's PDS fetch — the one network boundary."""
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = payload
    ctx = patch("backend.api.ingest.httpx.AsyncClient")
    return ctx, response


async def _like_count(db: AsyncSession) -> int:
    result = await db.execute(select(func.count()).select_from(TrackLike))
    return result.scalar_one()


def _post(client: TestClient, uri: str):
    return client.post("/ingest/record", json={"uri": uri})


async def test_echo_indexes_a_like_and_replay_is_idempotent(
    listener_app: FastAPI, db_session: AsyncSession, track: Track
) -> None:
    uri = _like_uri()
    ctx, response = _pds_answers(
        200, {"uri": uri, "cid": "bafylike", "value": _like_record(track)}
    )
    with TestClient(listener_app) as client, ctx as mock_client:
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(
            return_value=response
        )
        resp = _post(client, uri)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"status": "indexed"}
        assert await _like_count(db_session) == 1

        # the client double-clicks / retries: still one row
        assert _post(client, uri).json() == {"status": "indexed"}
        assert await _like_count(db_session) == 1

    # jetstream later replays the same create event: still one row
    await ingest_like_create(LISTENER_DID, "3likeecho", _like_record(track), uri)
    assert await _like_count(db_session) == 1


async def test_echo_of_a_deleted_record_removes_the_like(
    listener_app: FastAPI, db_session: AsyncSession, track: Track
) -> None:
    uri = _like_uri()
    await ingest_like_create(LISTENER_DID, "3likeecho", _like_record(track), uri)
    assert await _like_count(db_session) == 1

    ctx, response = _pds_answers(400, {"error": "RecordNotFound"})
    with TestClient(listener_app) as client, ctx as mock_client:
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(
            return_value=response
        )
        resp = _post(client, uri)
        assert resp.status_code == 200
        assert resp.json() == {"status": "deleted"}
    assert await _like_count(db_session) == 0

    # jetstream later replays the delete: still gone, no error
    await ingest_like_delete(LISTENER_DID, "3likeecho", uri)
    assert await _like_count(db_session) == 0


async def test_echo_never_trusts_the_claim_when_the_pds_disagrees(
    listener_app: FastAPI, db_session: AsyncSession, track: Track
) -> None:
    """a claimed create for a record the PDS does not have indexes nothing."""
    uri = _like_uri("3neverwritten")
    ctx, response = _pds_answers(400, {"error": "RecordNotFound"})
    with TestClient(listener_app) as client, ctx as mock_client:
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(
            return_value=response
        )
        assert _post(client, uri).json() == {"status": "deleted"}
    assert await _like_count(db_session) == 0


async def test_echo_rejects_a_record_in_someone_elses_repo(
    listener_app: FastAPI, db_session: AsyncSession
) -> None:
    with TestClient(listener_app) as client:
        resp = _post(client, f"at://did:test:artist/{LIKE_COLLECTION}/3x")
        assert resp.status_code == 403


async def test_echo_rejects_unindexed_collections_and_malformed_uris(
    listener_app: FastAPI, db_session: AsyncSession
) -> None:
    with TestClient(listener_app) as client:
        assert (
            _post(client, f"at://{LISTENER_DID}/app.bsky.feed.post/3x").status_code
            == 404
        )
        assert _post(client, "https://not-an-at-uri").status_code == 400
        assert (
            _post(client, f"at://{LISTENER_DID}/{LIKE_COLLECTION}").status_code == 400
        )


async def test_echo_for_an_unindexed_subject_is_a_404(
    listener_app: FastAPI, db_session: AsyncSession
) -> None:
    uri = _like_uri()
    record = {
        "$type": LIKE_COLLECTION,
        "subject": {
            "uri": "at://did:test:artist/fm.plyr.track/unknown",
            "cid": "bafyx",
        },
        "createdAt": "2026-08-31T00:00:00Z",
    }
    ctx, response = _pds_answers(200, {"uri": uri, "cid": "bafylike", "value": record})
    with TestClient(listener_app) as client, ctx as mock_client:
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(
            return_value=response
        )
        assert _post(client, uri).status_code == 404
