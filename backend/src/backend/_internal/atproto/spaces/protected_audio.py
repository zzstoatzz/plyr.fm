"""Artist-owned audio served through the app's Spaces credentials."""

import asyncio
import hashlib
import tempfile
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

import aiofiles
import aiofiles.os
import httpx
from atproto_core.cid import CID
from sqlalchemy import select, update

from backend._internal import Session
from backend._internal.atproto.client import BlobRef, upload_blob
from backend._internal.atproto.spaces.client import (
    MEMBER_LIST_POLICY,
    SpaceAccessError,
    _kem_key,
    _repo_host_url,
    _space_token_request,
    create_space_record,
    delete_space_record,
    get_space_credential,
    make_pds_request,
    open_space_blob,
)
from backend._internal.atproto.spaces.mac import (
    MAC_HEADER,
    RECORD_MAC_TYPE,
    WANT_MAC_HEADER,
    SpaceMacError,
    encapsulate,
    format_want_mac_header,
    parse_mac_header,
    verify_record_mac,
    verify_record_value,
)
from backend._internal.atproto.spaces.uris import (
    build_space_uri,
    parse_space_record_uri,
    parse_space_uri,
)
from backend._internal.auth.oauth import create_space_client_attestation
from backend._internal.pds_audio import upload_stored_audio
from backend.config import settings
from backend.models import Track
from backend.models.track_revision import TrackRevision
from backend.storage import storage
from backend.storage.keys import AudioKey
from backend.utilities.audio_formats import AudioFormat
from backend.utilities.database import db_session
from backend.utilities.hashing import CHUNK_SIZE


def protected_record_location(
    record_uri: str, *, owner: str | None = None
) -> tuple[str, str]:
    record = parse_space_record_uri(record_uri)
    space = parse_space_uri(record.space)
    if (
        space.owner_did != record.author_did
        or (owner is not None and record.author_did != owner)
        or space.space_type != settings.atproto.private_media_space_type
        or space.skey != "playback"
        or record.collection != settings.atproto.track_collection
    ):
        raise SpaceAccessError("invalid protected audio record location")
    return record.space, record.author_did


async def ensure_playback_space(session: Session) -> str:
    space = build_space_uri(
        session.did, settings.atproto.private_media_space_type, "playback"
    )
    if create_space_client_attestation(f"{session.did}#atproto_pds") is None:
        raise SpaceAccessError("protected audio requires a confidential app identity")
    policy = {
        "readPolicy": {"$type": "com.atproto.simplespace.defs#publicPolicy"},
        "writePolicy": MEMBER_LIST_POLICY,
        "appAccess": {
            "$type": "com.atproto.simplespace.defs#allowList",
            "allowed": [settings.atproto.client_id],
        },
    }
    try:
        await make_pds_request(
            session,
            "POST",
            "com.atproto.simplespace.createSpace",
            payload={
                "spaceType": settings.atproto.private_media_space_type,
                "skey": "playback",
                **policy,
            },
        )
    except Exception as exc:
        if "SpaceAlreadyExists" not in str(exc):
            raise
    actual = await make_pds_request(
        session, "GET", "com.atproto.simplespace.getSpace", params={"space": space}
    )
    if any(actual.get(key) != value for key, value in policy.items()):
        raise SpaceAccessError("playback Space has different access policies")
    return space


async def protect_audio_file(
    session: Session,
    path: str,
    *,
    file_id: str,
    file_type: str,
    title: str,
    rkey: str,
    needs_optimization: bool = False,
    heartbeat: Callable[[], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    await ensure_playback_space(session)

    async def body() -> AsyncIterator[bytes]:
        async with aiofiles.open(path, "rb") as source:
            while chunk := await source.read(CHUNK_SIZE):
                yield chunk

    import_size = (await aiofiles.os.stat(path)).st_size
    audio_format = AudioFormat.from_extension(file_type)
    if audio_format is None:
        raise ValueError("unsupported protected audio format")
    blob = await upload_blob(
        session,
        body_factory=body,
        content_length=import_size,
        content_type=audio_format.media_type,
        heartbeat=heartbeat,
    )
    return await publish_protected_blob(
        session,
        audio_blob=blob,
        file_id=file_id,
        file_type=file_type,
        title=title,
        rkey=rkey,
        original_file_id=file_id if needs_optimization else None,
        original_file_type=file_type if needs_optimization else None,
    )


async def publish_protected_blob(
    session: Session,
    *,
    audio_blob: BlobRef,
    file_id: str,
    file_type: str,
    title: str,
    original_blob: BlobRef | None = None,
    original_file_id: str | None = None,
    original_file_type: str | None = None,
    rkey: str | None = None,
) -> dict[str, Any]:
    space = await ensure_playback_space(session)
    record: dict[str, Any] = {
        "$type": settings.atproto.track_collection,
        "title": title,
        "artist": session.handle,
        "fileType": file_type,
        "audioFileId": file_id,
        "audioBlob": audio_blob,
        "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    if original_blob is not None:
        record["originalAudioBlob"] = original_blob
    if original_file_id and original_file_type:
        record["originalFileId"] = original_file_id
        record["originalFileType"] = original_file_type
    uri, cid = await create_space_record(
        session,
        space=space,
        collection=settings.atproto.track_collection,
        record=record,
        rkey=rkey,
    )
    result: dict[str, Any] = {
        "record_uri": uri,
        "record_cid": cid,
        "audio_blob": audio_blob,
        "mirror_verified": False,
    }
    if original_blob is not None:
        result["original_blob"] = original_blob
    return result


async def publish_protected_audio(
    session: Session,
    *,
    file_id: str,
    file_type: str,
    title: str,
    original_file_id: str | None = None,
    original_file_type: str | None = None,
) -> dict[str, Any]:
    await ensure_playback_space(session)

    async def upload(file_id: str, file_type: str) -> BlobRef:
        size = await storage.head_file(file_id, file_type, private=True)
        if size is None:
            raise SpaceAccessError("protected audio mirror is missing")
        return await upload_stored_audio(
            session, AudioKey.for_file(file_id, file_type), size, private=True
        )

    blob = await upload(file_id, file_type)
    original = None
    if original_file_id and original_file_type:
        original = (
            blob
            if original_file_id == file_id
            else await upload(original_file_id, original_file_type)
        )
    protected = await publish_protected_blob(
        session,
        audio_blob=blob,
        file_id=file_id,
        file_type=file_type,
        title=title,
        original_blob=original,
        original_file_id=original_file_id,
        original_file_type=original_file_type,
    )
    protected["mirror_verified"] = True
    return protected


async def delete_protected_audio(session: Session, protected_audio: dict) -> bool:
    uri = protected_audio["record_uri"]
    protected_record_location(uri, owner=session.did)
    async with db_session() as db:
        for model in (Track, TrackRevision):
            if await db.scalar(
                select(model.id)
                .where(model.protected_audio["record_uri"].astext == uri)
                .limit(1)
            ):
                return False
    try:
        await delete_space_record(session, uri)
    except Exception as exc:
        if "RecordNotFound" not in str(exc):
            raise

    return True


@asynccontextmanager
async def open_protected_blob(
    protected_audio: dict, *, original: bool = False, range_header: str | None = None
) -> AsyncIterator[httpx.Response]:
    space, repo = protected_record_location(protected_audio["record_uri"])
    blob = protected_audio.get("original_blob") if original else None
    blob = blob or protected_audio["audio_blob"]
    async with open_space_blob(
        None,
        space=space,
        repo=repo,
        cid=blob["ref"]["$link"],
        range_header=range_header,
    ) as response:
        yield response


async def resolve_protected_audio(record_uri: str, owner: str) -> tuple[dict, dict]:
    space, repo = protected_record_location(record_uri, owner=owner)
    record = parse_space_record_uri(record_uri)
    kem = await _kem_key(repo)
    if kem is None:
        raise SpaceAccessError("protected audio author has no KEM key")
    for attempt in range(2):
        credential = await get_space_credential(None, space, force_refresh=attempt > 0)
        exchange = encapsulate(kem)
        response = await _space_token_request(
            await _repo_host_url(repo),
            "GET",
            "com.atproto.space.getRecord",
            credential.token,
            credential.key,
            audience=repo,
            params={
                "space": space,
                "repo": repo,
                "collection": record.collection,
                "rkey": record.rkey,
            },
            extra_headers={
                WANT_MAC_HEADER: format_want_mac_header(
                    exchange.key_share, mac_type=RECORD_MAC_TYPE
                )
            },
        )
        if response.status_code == 401 and attempt == 0:
            continue
        if response.status_code != 200:
            raise SpaceAccessError(
                f"protected audio record unavailable: {response.status_code}"
            )
        body = response.json()
        if body.get("uri") != record_uri:
            raise SpaceAccessError("protected audio record URI mismatch")
        cid = body["cid"]
        try:
            verify_record_value(body["value"], cid)
            verify_record_mac(
                exchange.shared_secret,
                uri=record_uri,
                cid=cid,
                mac=parse_mac_header(
                    response.headers.get(MAC_HEADER), mac_type=RECORD_MAC_TYPE
                ),
            )
        except (SpaceMacError, ValueError) as exc:
            raise SpaceAccessError(f"protected audio record: {exc}") from exc
        value = body["value"]
        audio: dict = {
            "record_uri": record_uri,
            "record_cid": body["cid"],
            "audio_blob": value["audioBlob"],
        }
        if original := value.get("originalAudioBlob"):
            audio["original_blob"] = original
        return audio, value
    raise SpaceAccessError("protected audio credential was refused")


async def mirror_protected_audio(track_id: int) -> bool:
    async with db_session() as db:
        track = await db.get(Track, track_id)
        if track is None or not track.protected_audio:
            return False
        audio = dict(track.protected_audio)
        file_id, file_type = track.file_id, track.file_type
    space, _ = protected_record_location(audio["record_uri"])
    await get_space_credential(None, space)
    if audio.get("mirror_verified") is True:
        try:
            if await storage.head_file(file_id, file_type, private=True) is not None:
                return True
        except Exception:
            pass
    blob = audio["audio_blob"]
    digest = hashlib.sha256()
    size = 0
    with tempfile.NamedTemporaryFile(suffix=f".{file_type}") as tmp:
        async with (
            asyncio.timeout(600),
            aiofiles.open(tmp.name, "wb") as destination,
            open_protected_blob(audio) as response,
        ):
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > settings.storage.max_upload_size_mb * 1024 * 1024:
                    raise SpaceAccessError("protected audio exceeds the mirror limit")
                digest.update(chunk)
                await destination.write(chunk)
        cid = CID.decode(blob["ref"]["$link"])
        if (
            cid.hash.code != 0x12
            or cid.hash.digest != digest.digest()
            or size != blob["size"]
        ):
            raise SpaceAccessError("protected audio bytes do not match their PDS blob")
        if digest.hexdigest()[:16] != file_id:
            raise SpaceAccessError(
                "protected audio content hash does not match its record"
            )
        with open(tmp.name, "rb") as source:
            saved = await storage.save_gated(source, f"playback.{file_type}")
        if saved != file_id:
            raise SpaceAccessError("protected audio mirror hash mismatch")
    async with db_session() as db:
        result = await db.execute(
            update(Track)
            .where(Track.id == track_id, Track.protected_audio == audio)
            .values(protected_audio={**audio, "mirror_verified": True})
            .returning(Track.id)
        )
        await db.commit()
        return result.scalar_one_or_none() is not None
