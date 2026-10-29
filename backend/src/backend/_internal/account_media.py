"""Capture account media and remove only unreferenced application copies."""

import logging
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from atproto_core.cid import CID
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend._internal.atproto.spaces.client import SpaceAccessError
from backend._internal.atproto.spaces.protected_audio import (
    delete_protected_audio,
    protected_record_location,
)
from backend._internal.jobs import TERMINAL_STATUSES
from backend.config import settings
from backend.models import Album, Job, Playlist, Track, TrackRevision
from backend.storage import storage
from backend.storage.keys import AudioKey
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


@dataclass
class AccountMedia:
    audio: set[tuple[str, str, bool]] = field(default_factory=set)
    images: dict[str, str | None] = field(default_factory=dict)
    protected: dict[str, dict] = field(default_factory=dict)
    active_files: set[str] = field(default_factory=set)

    def capture_audio(self, row: Track | TrackRevision, owner: str) -> None:
        protected = row.protected_audio
        if protected:
            self.protected[protected["record_uri"]] = protected
            try:
                protected_record_location(protected["record_uri"], owner=owner)
            except (SpaceAccessError, ValueError):
                logger.warning("skipping foreign protected audio ownership claim")
                return
        if row.audio_storage == "pds" or (isinstance(row, Track) and row.is_private):
            return
        gated = row.uses_private_audio if isinstance(row, Track) else row.was_gated
        url = row.r2_url if isinstance(row, Track) else row.audio_url
        if not protected and url and AudioKey.from_url(url) is None:
            parsed = urlsplit(url)
            backend = urlsplit(settings.atproto.redirect_uri)
            if (
                not gated
                or parsed.netloc != backend.netloc
                or parsed.path != f"/audio/{row.file_id}"
            ):
                return
        candidates = [
            (
                row.file_id,
                row.file_type,
                protected.get("audio_blob") if protected else None,
            )
        ]
        if row.original_file_id and row.original_file_type:
            original = (
                protected.get("original_blob") or protected.get("audio_blob")
                if protected
                else None
            )
            candidates.append((row.original_file_id, row.original_file_type, original))
        for file_id, file_type, blob in candidates:
            try:
                if protected:
                    if protected.get("mirror_verified") is not True or not blob:
                        continue
                    cid = CID.decode(blob["ref"]["$link"])
                    if (
                        cid.codec != 0x55
                        or cid.hash.code != 0x12
                        or cid.hash.size != 32
                        or cid.hash.digest.hex()[:16] != file_id
                    ):
                        continue
                    key = AudioKey.for_file(file_id, file_type)
                elif file_id == row.file_id and url:
                    key = AudioKey.from_url(url)
                    if key is None:
                        if not gated:
                            continue
                        key = AudioKey.for_file(file_id, file_type)
                else:
                    key = AudioKey.for_file(file_id, file_type)
                self.audio.add((key.file_id, key.extension, bool(gated or protected)))
            except (ValueError, KeyError, TypeError):
                logger.warning("skipping unverified account audio reference")

    async def delete_copies(self) -> int:
        removed = 0
        for file_id, extension, gated in sorted(self.audio):
            try:
                if file_id in self.active_files or await file_referenced(file_id):
                    continue
                removed += bool(
                    await storage.discard_staged(file_id, extension, gated=gated)
                )
            except Exception:
                logger.exception("could not remove account audio copy")
        for file_id, url in self.images.items():
            try:
                if (
                    url
                    and urlsplit(url).netloc
                    != urlsplit(settings.storage.r2_public_image_bucket_url).netloc
                ):
                    continue
                if file_id in self.active_files or await file_referenced(file_id):
                    continue
                removed += bool(
                    await storage.delete_image(file_id, url)
                    if url
                    else await storage.discard_staged(file_id)
                )
            except Exception:
                logger.exception("could not remove account image")
        return removed

    async def delete_sources(self, session: Session) -> int:
        removed = 0
        for source in self.protected.values():
            try:
                removed += await delete_protected_audio(session, source)
            except Exception:
                logger.exception("could not remove account protected source")
        return removed


async def capture_account_media(
    db: AsyncSession, tracks: list[Track], owner: str
) -> AccountMedia:
    media = AccountMedia()
    for track in tracks:
        media.capture_audio(track, owner)
        if track.image_id:
            media.images[track.image_id] = track.image_url
    revisions = await db.scalars(
        select(TrackRevision).join(Track).where(Track.artist_did == owner)
    )
    for revision in revisions:
        media.capture_audio(revision, owner)
    albums = await db.execute(
        select(Album.image_id, Album.image_url).where(Album.artist_did == owner)
    )
    for image_id, url in albums:
        if image_id:
            media.images[image_id] = url
    active = await db.scalars(
        select(Job.file_id).where(
            Job.status.not_in(TERMINAL_STATUSES), Job.file_id.is_not(None)
        )
    )
    media.active_files = {file_id for file_id in active if file_id}

    return media


async def file_referenced(file_id: str) -> bool:
    conditions = [
        select(Track.id)
        .where(
            or_(
                Track.file_id == file_id,
                Track.original_file_id == file_id,
                Track.image_id == file_id,
                Track.r2_url.contains(f"/audio/{file_id}.", autoescape=True),
            )
        )
        .exists(),
        select(TrackRevision.id)
        .where(
            or_(
                TrackRevision.file_id == file_id,
                TrackRevision.original_file_id == file_id,
                TrackRevision.audio_url.contains(f"/audio/{file_id}.", autoescape=True),
            )
        )
        .exists(),
        select(Album.id).where(Album.image_id == file_id).exists(),
        select(Playlist.id).where(Playlist.image_id == file_id).exists(),
        select(Job.id)
        .where(Job.file_id == file_id, Job.status.not_in(TERMINAL_STATUSES))
        .exists(),
    ]
    async with db_session() as db:
        return bool(await db.scalar(select(or_(*conditions))))
