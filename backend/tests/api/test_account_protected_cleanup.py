"""Delete account media through real database and HTTP record boundaries."""

import hashlib
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from unittest.mock import AsyncMock

import httpx
import pytest
from aiohttp import web
from atproto_core.cid import CID
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import backend.storage
from backend._internal import Session, account_media, require_auth
from backend._internal.atproto.records.fm_plyr import track as track_records
from backend._internal.atproto.spaces import client as spaces
from backend._internal.atproto.spaces.uris import build_record_uri, build_space_uri
from backend._internal.tasks.pds_mirror import cid_for_blob
from backend.api import account
from backend.config import settings
from backend.models import Album, Artist, Job, Playlist, Track, TrackRevision
from backend.models.job import JobStatus, JobType

from .test_account_deletion import MockSession

OWNER = "did:plc:cleanupowner"
HANDLE = "cleanup.test"


@dataclass
class Boundary:
    objects: dict[tuple[str, str], bytes] = field(default_factory=dict)
    records: set[str] = field(default_factory=set)
    refused: set[str] = field(default_factory=set)
    requests: list[tuple[str, dict]] = field(default_factory=list)
    deleted: list[tuple[str, str]] = field(default_factory=list)

    async def delete(
        self, file_id: str, file_type: str | None = None, *, bucket: str = "public"
    ) -> bool:
        key = (
            (bucket, f"audio/{file_id}.{file_type}")
            if file_type
            else ("images", file_id)
        )
        self.deleted.append(key)
        return self.objects.pop(key, None) is not None

    async def delete_private(self, file_id: str, file_type: str | None = None) -> bool:
        return await self.delete(file_id, file_type, bucket="private")

    async def delete_image(self, file_id: str, image_url: str) -> bool:
        return await self.delete(file_id)


def source(boundary: Boundary, name: str) -> tuple[dict, str, str]:
    playback, original = f"{name} playback".encode(), f"{name} original".encode()
    file_id, original_id = [
        hashlib.sha256(body).hexdigest()[:16] for body in (playback, original)
    ]
    uri = build_record_uri(
        build_space_uri(OWNER, settings.atproto.private_media_space_type, "playback"),
        OWNER,
        settings.atproto.track_collection,
        name,
    )
    boundary.records.add(uri)
    boundary.objects[("private", f"audio/{file_id}.mp3")] = playback
    boundary.objects[("private", f"audio/{original_id}.aif")] = original

    def blob(body: bytes) -> dict:
        return {
            "$type": "blob",
            "ref": {"$link": cid_for_blob(body)},
            "size": len(body),
            "mimeType": "audio/mpeg",
        }

    return (
        {
            "record_uri": uri,
            "record_cid": "record-cid",
            "audio_blob": blob(playback),
            "original_blob": blob(original),
            "mirror_verified": True,
        },
        file_id,
        original_id,
    )


@pytest.fixture
async def boundary(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[Boundary]:
    state = Boundary()

    async def remove(request: web.Request) -> web.Response:
        payload = await request.json()
        endpoint = request.match_info["endpoint"]
        state.requests.append((endpoint, payload))
        assert payload["repo"] == OWNER
        uri = (
            (payload["space"] + "/" if "space" in payload else "at://")
            + payload["repo"]
            + "/"
            + payload["collection"]
            + "/"
            + payload["rkey"]
        )
        if payload["rkey"] in state.refused:
            return web.json_response({"error": "Forbidden"}, status=403)
        assert uri in state.records, f"unexpected deletion: {uri}"
        state.records.remove(uri)
        return web.json_response({})

    application = web.Application()
    application.router.add_post("/xrpc/{endpoint}", remove)
    runner = web.AppRunner(application)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", 0).start()
    url = f"http://127.0.0.1:{runner.addresses[0][1]}"

    async def owner_request(
        session: Session,
        method: str,
        endpoint: str,
        payload: dict | None = None,
        **kwargs: object,
    ) -> dict:
        assert session.did == OWNER
        async with httpx.AsyncClient() as http:
            response = await http.request(
                method, f"{url}/xrpc/{endpoint}", json=payload
            )
            response.raise_for_status()
            return response.json()

    monkeypatch.setattr(track_records, "make_pds_request", owner_request)
    monkeypatch.setattr(spaces, "make_pds_request", owner_request)
    store = backend.storage._get_storage()
    monkeypatch.setattr(store, "delete", state.delete)
    monkeypatch.setattr(store, "delete_gated", state.delete_private)
    monkeypatch.setattr(store, "delete_image", state.delete_image)
    try:
        yield state
    finally:
        await runner.cleanup()


@pytest.fixture
async def owner_app(db_session: AsyncSession) -> AsyncIterator[FastAPI]:
    db_session.add(Artist(did=OWNER, handle=HANDLE, display_name="Owner"))
    await db_session.commit()
    application = FastAPI()
    application.include_router(account.router)
    application.dependency_overrides[require_auth] = lambda: MockSession(
        did=OWNER, handle=HANDLE
    )
    yield application


async def delete_owner(application: FastAPI, opted_in: bool) -> httpx.Response:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=application), base_url="http://test"
    ) as http:
        return await http.request(
            "DELETE",
            "/account/",
            json={"confirmation": HANDLE, "delete_atproto_records": opted_in},
        )


async def add_protected(
    db: AsyncSession, boundary: Boundary
) -> tuple[Track, dict, dict]:
    current, file_id, original_id = source(boundary, "current")
    previous, old_id, old_original = source(boundary, "previous")
    public_uri = f"at://{OWNER}/{settings.atproto.track_collection}/public"
    boundary.records.add(public_uri)
    track = Track(
        artist_did=OWNER,
        title="protected",
        file_id=file_id,
        file_type="mp3",
        original_file_id=original_id,
        original_file_type="aif",
        protected_audio=current,
        audio_storage="r2_private",
        atproto_record_uri=public_uri,
        image_id="cover",
    )
    db.add(track)
    await db.flush()
    db.add(
        TrackRevision(
            track_id=track.id,
            file_id=old_id,
            file_type="mp3",
            original_file_id=old_original,
            original_file_type="aif",
            protected_audio=previous,
            audio_storage="r2_private",
            was_gated=True,
        )
    )
    private_uri = build_record_uri(
        build_space_uri(OWNER, settings.atproto.private_media_space_type, "self"),
        OWNER,
        settings.atproto.track_collection,
        "private",
    )
    boundary.records.add(private_uri)
    db.add(
        Track(
            artist_did=OWNER,
            title="member private",
            visibility="private",
            file_id="private-only",
            file_type="wav",
            audio_storage="pds",
            space_uri=build_space_uri(
                OWNER, settings.atproto.private_media_space_type, "self"
            ),
            atproto_record_uri=private_uri,
        )
    )
    db.add(Album(artist_did=OWNER, title="album", slug="album", image_id="cover"))
    boundary.objects[("images", "cover")] = b"cover"
    await db.commit()
    return track, current, previous


@pytest.mark.parametrize("opted_in", [False, True])
async def test_account_cleans_verified_mirrors_originals_revisions_and_respects_pds_choice(
    db_session: AsyncSession, owner_app: FastAPI, boundary: Boundary, opted_in: bool
) -> None:
    await add_protected(db_session, boundary)
    original_records = set(boundary.records)
    response = await delete_owner(owner_app, opted_in)
    assert response.status_code == 200, response.text
    assert response.json()["deleted"]["r2_objects"] == 5
    assert response.json()["deleted"]["atproto_records"] == (4 if opted_in else 0)
    assert boundary.objects == {}
    assert boundary.records == (set() if opted_in else original_records)
    assert (
        await db_session.scalar(select(Track.id).where(Track.artist_did == OWNER))
    ) is None
    if opted_in:
        assert {endpoint for endpoint, _ in boundary.requests} == {
            "com.atproto.repo.deleteRecord",
            "com.atproto.space.deleteRecord",
        }
    else:
        assert not boundary.requests


async def test_shared_revisions_sources_images_and_active_jobs_survive(
    db_session: AsyncSession, owner_app: FastAPI, boundary: Boundary
) -> None:
    track, current, previous = await add_protected(db_session, boundary)
    other = Artist(
        did="did:plc:othercleanup", handle="other.test", display_name="Other"
    )
    db_session.add(other)
    await db_session.flush()
    sibling = Track(
        artist_did=other.did,
        title="sibling",
        file_id="different",
        file_type="mp3",
        protected_audio=current,
    )
    db_session.add(sibling)
    await db_session.flush()
    db_session.add(
        TrackRevision(
            track_id=sibling.id,
            file_id=track.file_id,
            file_type="mp3",
            original_file_id=track.original_file_id,
            original_file_type="aif",
            audio_storage="r2_private",
            protected_audio=previous,
            was_gated=True,
        )
    )
    db_session.add(Playlist(owner_did=other.did, name="shared cover", image_id="cover"))
    old_id = hashlib.sha256(b"previous playback").hexdigest()[:16]
    old_original = hashlib.sha256(b"previous original").hexdigest()[:16]
    db_session.add(
        Job(
            owner_did=OWNER,
            type=JobType.UPLOAD.value,
            status=JobStatus.PROCESSING.value,
            file_id=old_id,
        )
    )
    db_session.add(
        Job(
            owner_did=other.did,
            type=JobType.UPLOAD.value,
            status=JobStatus.PROCESSING.value,
            file_id=old_original,
        )
    )
    await db_session.commit()
    before = dict(boundary.objects)
    response = await delete_owner(owner_app, True)
    assert response.status_code == 200, response.text
    assert response.json()["deleted"]["r2_objects"] == 0
    assert response.json()["deleted"]["atproto_records"] == 2
    assert boundary.objects == before
    assert boundary.records == {current["record_uri"], previous["record_uri"]}


async def test_remote_refusal_is_best_effort_and_does_not_inflate_deleted_count(
    db_session: AsyncSession, owner_app: FastAPI, boundary: Boundary
) -> None:
    await add_protected(db_session, boundary)
    boundary.refused.add("current")
    response = await delete_owner(owner_app, True)
    assert response.status_code == 200, response.text
    assert response.json()["deleted"]["atproto_records"] == 3
    assert len(boundary.records) == 1
    assert boundary.records.pop().endswith("/current")
    assert not boundary.objects


@pytest.mark.parametrize("verified", [False, True])
async def test_imported_claimed_hash_cannot_delete_foreign_private_objects(
    db_session: AsyncSession, owner_app: FastAPI, boundary: Boundary, verified: bool
) -> None:
    audio, file_id, original_id = source(boundary, "claimed")
    victim_id = hashlib.sha256(b"foreign private bytes").hexdigest()[:16]
    boundary.objects[("private", f"audio/{victim_id}.aif")] = b"foreign private bytes"
    boundary.objects[("private", f"audio/{victim_id}.mp3")] = b"foreign private bytes"
    audio["mirror_verified"] = verified
    track = Track(
        artist_did=OWNER,
        title="imported",
        file_id=file_id if verified else victim_id,
        file_type="mp3",
        original_file_id=victim_id,
        original_file_type="aif",
        audio_storage="r2_private",
        protected_audio=audio,
    )
    db_session.add(track)
    await db_session.commit()
    response = await delete_owner(owner_app, False)
    assert response.status_code == 200
    assert (
        boundary.objects[("private", f"audio/{victim_id}.aif")]
        == b"foreign private bytes"
    )
    assert (
        boundary.objects[("private", f"audio/{original_id}.aif")] == b"claimed original"
    )
    assert response.json()["deleted"]["r2_objects"] == (1 if verified else 0)


async def test_legacy_public_private_originals_and_revision_buckets(
    db_session: AsyncSession,
    owner_app: FastAPI,
    boundary: Boundary,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.storage, "r2_public_bucket_url", "https://audio.test")
    public = Track(
        artist_did=OWNER,
        title="public legacy",
        file_id="external-rkey",
        file_type="mp3",
        r2_url="https://audio.test/audio/public-key.mp3",
    )
    private = Track(
        artist_did=OWNER,
        title="private legacy",
        file_id="private-key",
        file_type="mp3",
        audio_storage="r2_private",
        original_file_id="private-master",
        original_file_type="wav",
    )
    db_session.add_all([public, private])
    await db_session.flush()
    db_session.add(
        TrackRevision(
            track_id=private.id,
            file_id="revision",
            file_type="mp3",
            original_file_id="revision-master",
            original_file_type="aif",
            audio_storage="r2",
            was_gated=False,
        )
    )
    for bucket, key in [
        ("public", "public-key.mp3"),
        ("private", "private-key.mp3"),
        ("private", "private-master.wav"),
        ("public", "revision.mp3"),
        ("public", "revision-master.aif"),
    ]:
        boundary.objects[(bucket, f"audio/{key}")] = key.encode()
    boundary.objects[("public", "audio/private-key.mp3")] = b"other public copy"
    boundary.objects[("private", "audio/public-key.mp3")] = b"other private copy"
    await db_session.commit()
    response = await delete_owner(owner_app, False)
    assert response.status_code == 200, response.text
    assert response.json()["deleted"]["r2_objects"] == 5
    assert boundary.objects == {
        ("public", "audio/private-key.mp3"): b"other public copy",
        ("private", "audio/public-key.mp3"): b"other private copy",
    }


@pytest.mark.parametrize(
    "reference", ["track", "revision_url", "album", "playlist", "job"]
)
async def test_a_single_remaining_reference_protects_the_object(
    db_session: AsyncSession,
    owner_app: FastAPI,
    boundary: Boundary,
    monkeypatch: pytest.MonkeyPatch,
    reference: str,
) -> None:
    monkeypatch.setattr(settings.storage, "r2_public_bucket_url", "https://audio.test")
    db_session.add(
        Track(
            artist_did=OWNER,
            title="deleting",
            file_id="shared",
            file_type="mp3",
            audio_storage="r2_private",
        )
    )
    other = Artist(did="did:plc:refcleanup", handle="ref.test", display_name="Other")
    db_session.add(other)
    await db_session.flush()
    keeper = Track(
        artist_did=other.did,
        title="keeper",
        file_id="shared" if reference == "track" else "keeper",
        file_type="mp3",
    )
    db_session.add(keeper)
    await db_session.flush()
    if reference == "revision_url":
        db_session.add(
            TrackRevision(
                track_id=keeper.id,
                file_id="old-rkey",
                file_type="mp3",
                audio_storage="r2",
                audio_url="https://audio.test/audio/shared.mp3",
            )
        )
    elif reference == "album":
        db_session.add(
            Album(
                artist_did=other.did, slug="keeper", title="keeper", image_id="shared"
            )
        )
    elif reference == "playlist":
        db_session.add(Playlist(owner_did=other.did, name="keeper", image_id="shared"))
    elif reference == "job":
        db_session.add(
            Job(
                owner_did=other.did,
                type=JobType.UPLOAD.value,
                status=JobStatus.PENDING.value,
                file_id="shared",
            )
        )
    boundary.objects[("private", "audio/shared.mp3")] = b"shared bytes"
    await db_session.commit()
    response = await delete_owner(owner_app, False)
    assert response.status_code == 200, response.text
    assert response.json()["deleted"]["r2_objects"] == 0
    assert boundary.objects[("private", "audio/shared.mp3")] == b"shared bytes"
    assert not boundary.deleted


async def test_foreign_source_and_storage_claims_are_not_deleted(
    db_session: AsyncSession, owner_app: FastAPI, boundary: Boundary
) -> None:
    audio, file_id, original_id = source(boundary, "foreign")
    audio["record_uri"] = audio["record_uri"].replace(OWNER, "did:plc:foreign")
    audio["mirror_verified"] = True
    db_session.add(
        Track(
            artist_did=OWNER,
            title="foreign source",
            file_id=file_id,
            file_type="mp3",
            original_file_id=original_id,
            original_file_type="aif",
            protected_audio=audio,
            audio_storage="r2_private",
        )
    )
    db_session.add(
        Track(
            artist_did=OWNER,
            title="foreign URL",
            file_id="claimed",
            file_type="mp3",
            r2_url="https://foreign.test/audio/claimed.mp3",
            image_id="foreign-image",
            image_url="https://foreign.test/images/foreign-image.png",
        )
    )
    boundary.objects[("public", "audio/claimed.mp3")] = b"foreign claim"
    boundary.objects[("images", "foreign-image")] = b"foreign image"
    await db_session.commit()
    before = dict(boundary.objects)
    response = await delete_owner(owner_app, True)
    assert response.status_code == 200, response.text
    assert response.json()["deleted"]["atproto_records"] == 0
    assert response.json()["deleted"]["r2_objects"] == 0
    assert boundary.objects == before
    assert not boundary.requests


async def test_postcommit_reference_probe_failure_keeps_media_and_account_deletion_succeeds(
    db_session: AsyncSession,
    owner_app: FastAPI,
    boundary: Boundary,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await add_protected(db_session, boundary)
    before = dict(boundary.objects)
    monkeypatch.setattr(
        account_media,
        "file_referenced",
        AsyncMock(side_effect=ConnectionError("database unavailable")),
    )
    response = await delete_owner(owner_app, False)
    assert response.status_code == 200, response.text
    assert response.json()["deleted"]["r2_objects"] == 0
    assert (
        await db_session.scalar(select(Track.id).where(Track.artist_did == OWNER))
        is None
    )
    assert boundary.objects == before
    assert boundary.deleted == []


@pytest.mark.parametrize(
    "header,length", [(b"\x01\x71\x12\x20", 32), (b"\x01\x55\x12\x10", 16)]
)
async def test_non_raw_or_short_blob_hash_cannot_claim_a_private_mirror(
    db_session: AsyncSession,
    owner_app: FastAPI,
    boundary: Boundary,
    header: bytes,
    length: int,
) -> None:
    audio, file_id, _ = source(boundary, "invalid-cid")
    digest = hashlib.sha256(b"invalid-cid playback").digest()
    audio["audio_blob"]["ref"]["$link"] = CID.decode(header + digest[:length]).encode()
    db_session.add(
        Track(
            artist_did=OWNER,
            title="invalid CID claim",
            file_id=file_id,
            file_type="mp3",
            audio_storage="r2_private",
            protected_audio=audio,
        )
    )
    await db_session.commit()
    before = dict(boundary.objects)
    response = await delete_owner(owner_app, False)
    assert response.status_code == 200, response.text
    assert response.json()["deleted"]["r2_objects"] == 0
    assert boundary.objects == before
    assert not boundary.deleted
