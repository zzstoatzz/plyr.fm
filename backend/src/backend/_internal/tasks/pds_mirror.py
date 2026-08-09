"""mirror PDS-hosted audio into R2 after verifying it against its CID.

a track ingested from the firehose may have no R2 object of our own: the
audio lives as a blob on the artist's PDS and `resolve_audio_url` builds a
`com.atproto.sync.getBlob` URL for it. handing that URL to AudD, Modal, and
Replicate treats an endpoint the uploader operates as if it were our own
immutable storage — the bytes are served fresh on every request, so the
copyright scanner can be shown one thing and listeners another, and the
fetch doubles as a callback oracle telling the uploader exactly when each
vendor processed their track (#1778).

so we fetch the blob once, check that it hashes to the `pds_blob_cid` the
record committed to, and store our verified copy. scans then run against
bytes we can vouch for. this is the same trade an index makes everywhere:
hold a copy, and earn the right to by verifying it.

the CID is what makes the copy legitimate rather than presumptuous, and it
is self-securing: the fetch targets the PDS that slingshot resolved for the
DID, so a record naming bytes that PDS does not serve simply fails to
mirror. an unverified event can cause a failed mirror, never a wrong one.
"""

import base64
import hashlib
import logging
from io import BytesIO

import logfire
from atproto_oauth.security import get_hardened_async_client, is_safe_url
from sqlalchemy import select

from backend._internal.atproto.client import pds_blob_url
from backend._internal.background import get_docket
from backend._internal.delivery_origins import upsert_verified_r2_origin
from backend.config import settings
from backend.models import Artist, Track
from backend.storage import storage
from backend.storage.keys import AudioKey, InvalidMediaExtension
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

# CIDv1, raw codec, sha256, 32 bytes — the multihash prefix atproto blob refs
# use. verified against a live blob rather than inferred from the spec.
_CIDV1_RAW_SHA256_PREFIX = bytes([0x01, 0x55, 0x12, 0x20])


class BlobVerificationError(Exception):
    """the fetched bytes are not the bytes the record committed to."""


def cid_for_blob(data: bytes) -> str:
    """the CIDv1 an atproto PDS would advertise for these bytes."""
    multihash = _CIDV1_RAW_SHA256_PREFIX + hashlib.sha256(data).digest()
    return "b" + base64.b32encode(multihash).decode().lower().rstrip("=")


async def mirror_pds_blob(track_id: int) -> None:
    """fetch, verify, and store a track's PDS blob as our own R2 object.

    idempotent: a track that already has an R2 object is left alone, and a
    re-run after a partial failure re-fetches and re-verifies from scratch.
    """
    async with db_session() as db:
        row = (
            await db.execute(
                select(
                    Track.r2_url,
                    Track.atproto_record_uri,
                    Track.atproto_record_cid,
                    Track.pds_blob_cid,
                    Track.file_type,
                    Track.artist_did,
                    Artist.pds_url,
                )
                .join(Artist, Artist.did == Track.artist_did)
                .where(Track.id == track_id)
                .limit(1)
            )
        ).first()

    if not row:
        logger.debug("mirror_pds_blob: unknown track %s", track_id)
        return

    r2_url, record_uri, record_cid, blob_cid, file_type, artist_did, artist_pds_url = (
        row
    )

    if r2_url:
        return
    if not (blob_cid and artist_pds_url and is_safe_url(artist_pds_url)):
        logfire.info(
            "mirror_pds_blob: nothing safe to mirror",
            track_id=track_id,
            has_cid=blob_cid is not None,
        )
        return

    try:
        # the extension is validated before the fetch so an unstorable file
        # type fails without spending the bandwidth
        audio_format = AudioKey.for_file("verify", file_type).format
    except InvalidMediaExtension:
        logfire.warn(
            "mirror_pds_blob: unsupported file type",
            track_id=track_id,
            file_type=file_type,
        )
        return

    data = await _fetch_blob(artist_pds_url, artist_did, blob_cid)
    if data is None:
        return

    if (actual := cid_for_blob(data)) != blob_cid:
        # the PDS served bytes the record does not commit to. this is the
        # case the whole task exists to catch, so it is loud.
        logfire.error(
            "mirror_pds_blob: blob does not match its CID",
            track_id=track_id,
            expected_cid=blob_cid,
            actual_cid=actual,
            byte_count=len(data),
        )
        raise BlobVerificationError(
            f"track {track_id}: PDS served {actual}, record commits to {blob_cid}"
        )

    file_id = await storage.save(BytesIO(data), f"blob.{file_type}")
    stored_url = await storage.get_url(file_id, file_type=file_type)
    if not stored_url:
        logfire.error("mirror_pds_blob: stored blob has no URL", track_id=track_id)
        return

    async with db_session() as db:
        track = await db.get(Track, track_id)
        if not track:
            return
        if (
            track.atproto_record_uri != record_uri
            or track.atproto_record_cid != record_cid
            or track.pds_blob_cid != blob_cid
            or track.file_type != file_type
        ):
            # The record changed while its old blob was in flight. The R2
            # object is content-addressed and harmless, but it is not current
            # delivery evidence and must never be attached to the new row.
            logfire.info(
                "mirror_pds_blob: record changed during mirror",
                track_id=track_id,
                mirrored_record_cid=record_cid,
                current_record_cid=track.atproto_record_cid,
            )
            return

        track.r2_url = stored_url
        track.file_id = file_id
        track.audio_storage = "both"
        if record_uri and record_cid:
            await upsert_verified_r2_origin(
                db,
                record_uri=record_uri,
                record_cid=record_cid,
                origin_url=stored_url,
                media_type=audio_format.media_type,
                artifact_cid=blob_cid,
            )
        await db.commit()

    logfire.info(
        "mirror_pds_blob: verified and stored",
        track_id=track_id,
        cid=blob_cid,
        file_id=file_id,
        byte_count=len(data),
    )

    # hooks imports this module, so the re-entry import is deferred
    from backend._internal.tasks.hooks import run_post_track_create_hooks

    # now that the track has an audio object of ours, the hooks resolve to it
    # and the vendor-facing steps run against bytes we verified. followers were
    # already notified on the first pass, and staging does not spend AudD
    # credits on ingested tracks -- both mirroring what `ingest` passes.
    await run_post_track_create_hooks(
        track_id,
        skip_notification=True,
        skip_copyright=settings.observability.environment == "staging",
    )


async def _fetch_blob(pds_url: str, did: str, cid: str) -> bytes | None:
    """download a blob, refusing anything larger than an upload would be."""
    max_bytes = settings.storage.max_upload_size_mb * 1024 * 1024
    url = pds_blob_url(pds_url, did, cid)

    async with (
        get_hardened_async_client() as client,
        client.stream("GET", url) as response,
    ):
        if response.status_code != 200:
            logfire.warn(
                "mirror_pds_blob: PDS returned {status}",
                status=response.status_code,
                cid=cid,
            )
            return None

        chunks: list[bytes] = []
        total = 0
        async for chunk in response.aiter_bytes():
            total += len(chunk)
            if total > max_bytes:
                # a PDS can advertise any length, or none, so the cap is
                # enforced on what actually arrives
                logfire.warn(
                    "mirror_pds_blob: blob exceeds the upload ceiling",
                    cid=cid,
                    max_bytes=max_bytes,
                )
                return None
            chunks.append(chunk)

    return b"".join(chunks)


async def schedule_pds_blob_mirror(track_id: int) -> None:
    """schedule a verified mirror via docket."""
    docket = get_docket()
    await docket.add(mirror_pds_blob)(track_id)
    logfire.info("scheduled pds blob mirror", track_id=track_id)
