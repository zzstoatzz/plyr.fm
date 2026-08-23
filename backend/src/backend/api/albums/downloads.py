"""album download — a cached zip of an all-downloadable album.

GET /albums/{handle}/{slug}/download either redirects to the cached zip in
R2 (bytes served by the CDN, never proxied through the app) or enqueues a
worker build and returns 202 with a job id the client can follow on the
exports SSE endpoint. the cache key encodes a digest of the ordered member
tracks, so editing the album naturally invalidates; the worker sweeps stale
digests when it publishes a fresh one.
"""

import hashlib
import logging
from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import get_optional_session, validate_supporter
from backend._internal.export_tasks import schedule_album_download
from backend._internal.jobs import job_service
from backend._internal.track_visibility import visible_filter
from backend.models import Album, Artist, Track, get_db
from backend.models.job import JobType
from backend.storage import storage
from backend.utilities.downloads import (
    download_filename,
    download_key,
    download_refusal,
    effective_download_policy,
)

from .listing import order_album_tracks
from .router import router

logger = logging.getLogger(__name__)


class AlbumDownloadPending(BaseModel):
    """the zip is being built; follow /exports/{job_id}/progress."""

    job_id: str
    status: str = "preparing"


@router.get("/{handle}/{slug}/download", response_model=None)
async def download_album(
    handle: str,
    slug: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: AuthSession | None = Depends(get_optional_session),
) -> RedirectResponse | AlbumDownloadPending:
    """download an album as a zip, if every member track is downloadable.

    anonymous by design, like the track download endpoint: eligibility is
    the same shared policy (no gated, copyright-labeled, or artist-opted-out
    tracks, and we must actually hold every object).
    """
    row = (
        await db.execute(
            select(Album, Artist)
            .join(Artist, Album.artist_did == Artist.did)
            .where(Artist.handle == handle, Album.slug == slug)
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="album not found")
    album, artist = row

    tracks = list(
        (
            await db.execute(
                select(Track)
                .options(selectinload(Track.artist))
                .where(Track.album_id == album.id)
                # anonymous viewer: public tracks only
                .where(await visible_filter(None))
            )
        )
        .scalars()
        .all()
    )
    if not tracks:
        raise HTTPException(status_code=404, detail="no downloadable tracks")

    ordered = await order_album_tracks(album, artist, tracks)

    # supporter standing: the album's tracks share one artist, so one check
    viewer_is_artist = session is not None and session.did == album.artist_did
    viewer_is_supporter = False
    artist_prefs = ordered[0].artist.preferences
    album_policy = effective_download_policy(
        artist_prefs.download_policy if artist_prefs else None,
        artist_prefs.support_url if artist_prefs else None,
    )
    if album_policy == "supporters" and session is not None and not viewer_is_artist:
        validation = await validate_supporter(
            supporter_did=session.did, artist_did=album.artist_did
        )
        viewer_is_supporter = validation.valid

    entries: list[tuple[int, str, str]] = []  # (track_id, key, entry name)
    for position, track in enumerate(ordered, start=1):
        refusal = download_refusal(
            is_private=track.is_private,
            support_gate=track.support_gate,
            labels=set(track.self_labels or []) | set(track.operator_labels or []),
            moderation_override=track.moderation_override,
            download_policy=album_policy,
            viewer_is_artist=viewer_is_artist,
            viewer_is_supporter=viewer_is_supporter,
        )
        if refusal == "supporters_only":
            if session is None:
                raise HTTPException(
                    status_code=401, detail="sign in to download this album"
                )
            raise HTTPException(
                status_code=403,
                detail="downloads are for supporters",
                headers={"X-Support-Required": "true"},
            )
        if refusal is not None:
            raise HTTPException(
                status_code=403,
                detail="this album is not available for download",
            )
        key = download_key(
            file_id=track.file_id,
            file_type=track.file_type,
            original_file_id=track.original_file_id,
            original_file_type=track.original_file_type,
            r2_url=track.r2_url,
            audio_storage=track.audio_storage,
        )
        if key is None:
            raise HTTPException(status_code=404, detail="no downloadable file")
        entry = f"{position:02d} " + download_filename(
            track.artist.display_name, track.title, key.extension
        )
        entries.append((track.id, key.key, entry))

    digest = hashlib.sha256(
        "\n".join(f"{key}|{entry}" for _, key, entry in entries).encode()
    ).hexdigest()[:16]
    r2_key = f"exports/albums/{album.id}-{digest}.zip"

    if await storage.object_exists(r2_key):
        return RedirectResponse(url=f"{storage.public_audio_bucket_url}/{r2_key}")

    zip_filename = download_filename(artist.display_name, album.title, "zip")
    job_id = await job_service.create_job(
        JobType.EXPORT, album.artist_did, "album download queued"
    )
    await schedule_album_download(
        job_id, [track_id for track_id, _, _ in entries], r2_key, zip_filename
    )
    return AlbumDownloadPending(job_id=job_id)
