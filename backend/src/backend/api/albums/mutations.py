"""write endpoints for albums (create, update, delete, cover upload, finalize)."""

import contextlib
import logging
from datetime import datetime
from typing import Annotated

from fastapi import Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import require_artist_profile
from backend._internal.image_uploads import COVER_EXTENSIONS, process_image_upload
from backend.models import Album, Artist, Track, get_db
from backend.storage import storage
from backend.utilities.slugs import slugify

from .cache import (
    _album_metadata,
    _album_stats,
    invalidate_album_cache,
)
from .router import router
from .schemas import (
    AlbumCreatePayload,
    AlbumFinalizePayload,
    AlbumMetadata,
    DeleteAlbumResponse,
    RemoveTrackFromAlbumResponse,
)

logger = logging.getLogger(__name__)


@router.post("/")
async def create_album(
    body: AlbumCreatePayload,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Annotated[AuthSession, Depends(require_artist_profile)],
) -> AlbumMetadata:
    """create an empty album shell for the multi-track upload flow.

    the ATProto list record is NOT written here — it is deferred to
    `POST /albums/{id}/finalize`, which runs after tracks have actually
    been published so a total upload failure doesn't leave a fake release
    behind. for the same reason, the `album_release` CollectionEvent is
    also deferred to finalize (first successful call only, deduped).

    idempotent on (artist_did, slug): if an album with the same slug
    already exists, the existing row is returned instead of failing.
    this preserves the "type an existing album name to add tracks to it"
    UX — see finalize_album for the append semantics.
    """
    from sqlalchemy.exc import IntegrityError

    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    slug = body.slug.strip() if body.slug else slugify(title)
    if not slug:
        raise HTTPException(status_code=400, detail="invalid slug")

    description = body.description.strip() if body.description else None

    # lookup artist for the response payload
    artist_result = await db.execute(
        select(Artist).where(Artist.did == auth_session.did)
    )
    artist = artist_result.scalar_one()

    # idempotent on (artist_did, slug) — matches get_or_create_album semantics
    existing_result = await db.execute(
        select(Album).where(Album.artist_did == artist.did, Album.slug == slug)
    )
    if existing := existing_result.scalar_one_or_none():
        track_count, total_plays = await _album_stats(db, existing.id)
        return await _album_metadata(existing, artist, track_count, total_plays)

    album = Album(
        artist_did=artist.did,
        slug=slug,
        title=title,
        description=description,
    )
    db.add(album)
    try:
        await db.flush()
    except IntegrityError:
        # concurrent create raced us — return the winning row
        await db.rollback()
        retry_result = await db.execute(
            select(Album).where(Album.artist_did == artist.did, Album.slug == slug)
        )
        album = retry_result.scalar_one()
        track_count, total_plays = await _album_stats(db, album.id)
        return await _album_metadata(album, artist, track_count, total_plays)

    await db.commit()
    await db.refresh(album)

    return await _album_metadata(album, artist, track_count=0, total_plays=0)


@router.post("/{album_id}/cover")
async def upload_album_cover(
    album_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Annotated[AuthSession, Depends(require_artist_profile)],
    image: UploadFile = File(...),
) -> dict[str, str | None]:
    """upload cover art for an album (requires authentication)."""
    # verify album exists and belongs to the authenticated artist
    result = await db.execute(select(Album).where(Album.id == album_id))
    album = result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=404, detail="album not found")
    if album.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403, detail="you can only upload cover art for your own albums"
        )

    try:
        uploaded = await process_image_upload(
            image, "album", allowed_extensions=COVER_EXTENSIONS
        )

        # delete old image if exists (prevent R2 object leaks)
        if album.image_id and album.image_id != uploaded.image_id:
            with contextlib.suppress(Exception):
                if album.image_url:
                    await storage.delete_image(album.image_id, album.image_url)
                else:
                    await storage.delete(album.image_id)

        # update album with new image
        album.image_id = uploaded.image_id
        album.image_url = uploaded.image_url
        album.thumbnail_url = uploaded.thumbnail_url
        await db.commit()

        await invalidate_album_cache(auth_session.handle, album.slug)

        return {
            "image_url": uploaded.image_url,
            "image_id": uploaded.image_id,
            "thumbnail_url": uploaded.thumbnail_url,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to upload image: {e!s}"
        ) from e


@router.post("/{album_id}/finalize")
async def finalize_album(
    album_id: str,
    body: AlbumFinalizePayload,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Annotated[AuthSession, Depends(require_artist_profile)],
) -> AlbumMetadata:
    """write the album's ATProto list record using an explicit track order.

    called by the frontend after per-track uploads have settled. this is
    the single place the list record is created/updated for albums built
    via `POST /albums/` + `POST /tracks/?album_id=...`.

    append semantics: `track_ids` carries only the tracks from the current
    upload session. any tracks already on the album that are NOT in
    `track_ids` are preserved in the list record at their current positions
    (fetched from the existing list record if present, falling back to
    created_at order). new tracks are appended at the end in the order
    requested. this matches the "type an existing album name to add tracks
    to it" UX without truncating prior track history.

    also emits an `album_release` CollectionEvent on the first successful
    finalize for the album — so total upload failures don't leave a fake
    release event in the activity feed.
    """
    from backend._internal.atproto.records import get_record_public_resilient
    from backend._internal.atproto.records.fm_plyr.list import (
        upsert_album_list_record,
    )
    from backend.models import CollectionEvent

    if not body.track_ids:
        raise HTTPException(status_code=400, detail="track_ids must not be empty")

    # verify album ownership
    album_result = await db.execute(select(Album).where(Album.id == album_id))
    album = album_result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=404, detail="album not found")
    if album.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403, detail="you can only finalize your own albums"
        )

    # fetch the requested tracks for validation
    requested_result = await db.execute(
        select(Track).where(Track.id.in_(body.track_ids))
    )
    requested_by_id = {t.id: t for t in requested_result.scalars().all()}

    # validate: every requested id exists, belongs to this album, and has a
    # completed PDS write. surface specific errors so the frontend can retry
    # or message the user precisely.
    missing = [tid for tid in body.track_ids if tid not in requested_by_id]
    if missing:
        raise HTTPException(status_code=400, detail=f"track(s) not found: {missing}")

    wrong_album = [
        tid for tid in body.track_ids if requested_by_id[tid].album_id != album_id
    ]
    if wrong_album:
        raise HTTPException(
            status_code=400,
            detail=f"track(s) do not belong to this album: {wrong_album}",
        )

    missing_pds = [
        tid
        for tid in body.track_ids
        if not requested_by_id[tid].atproto_record_uri
        or not requested_by_id[tid].atproto_record_cid
    ]
    if missing_pds:
        raise HTTPException(
            status_code=400,
            detail=(
                f"track(s) missing PDS record (upload may still be in flight): "
                f"{missing_pds}"
            ),
        )

    # fetch ALL PDS-ref'd tracks already on this album — these may include
    # tracks from prior upload sessions that the current request doesn't
    # mention and must be preserved in the list record.
    existing_result = await db.execute(
        select(Track).where(
            Track.album_id == album_id,
            Track.atproto_record_uri.isnot(None),
            Track.atproto_record_cid.isnot(None),
        )
    )
    all_album_tracks = {t.id: t for t in existing_result.scalars().all()}

    # partition: preserved (existing, not in this request) vs new (in this request).
    # a track id that appears in both sets is treated as "new" so a repeat finalize
    # with the same ids rewrites the order deterministically.
    requested_set = set(body.track_ids)
    preserved_tracks = [
        t for tid, t in all_album_tracks.items() if tid not in requested_set
    ]

    # determine preserved order: if the album already has a list record, honor
    # its current item order (which captures any manual reorderings the owner
    # made from the album edit page). fall back to created_at for tracks not
    # in the existing list, or if the PDS fetch fails entirely.
    preserved_position_by_uri: dict[str, int] = {}
    if album.atproto_record_uri and preserved_tracks:
        try:
            artist_lookup = await db.execute(
                select(Artist).where(Artist.did == album.artist_did)
            )
            artist_for_pds = artist_lookup.scalar_one()
            record_data, _ = await get_record_public_resilient(
                record_uri=album.atproto_record_uri,
                pds_url=artist_for_pds.pds_url,
            )
            items = record_data.get("value", {}).get("items", [])
            for i, item in enumerate(items):
                uri = item.get("subject", {}).get("uri")
                if uri:
                    preserved_position_by_uri[uri] = i
        except Exception as e:
            logger.debug(
                f"finalize_album: failed to fetch existing list for preserved "
                f"track order on {album_id}: {e}"
            )

    def _preserved_sort_key(t: Track) -> tuple[int, datetime]:
        # tracks already in the existing list: keep their position
        # tracks not in the existing list (or if fetch failed): sort by created_at
        # after all positioned items
        pos = preserved_position_by_uri.get(t.atproto_record_uri or "", 10_000_000)
        return (pos, t.created_at)

    preserved_tracks.sort(key=_preserved_sort_key)

    # build the final list: preserved (existing, at front) + new (in requested order)
    final_order: list[Track] = list(preserved_tracks) + [
        requested_by_id[tid] for tid in body.track_ids
    ]

    # strongRefs in final order (the validation above guarantees these are
    # non-None for the requested tracks; preserved tracks were filtered at
    # fetch time, but narrow for the type checker)
    track_refs: list[dict[str, str]] = []
    for t in final_order:
        assert t.atproto_record_uri is not None
        assert t.atproto_record_cid is not None
        track_refs.append({"uri": t.atproto_record_uri, "cid": t.atproto_record_cid})

    try:
        result = await upsert_album_list_record(
            auth_session,
            album_id=album_id,
            album_title=album.title,
            track_refs=track_refs,
            existing_uri=album.atproto_record_uri,
            existing_created_at=album.created_at,
        )
    except Exception as e:
        logger.warning(f"failed to write album list record for {album_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"failed to write album list record: {e}"
        ) from e

    if result:
        album.atproto_record_uri = result[0]
        album.atproto_record_cid = result[1]

    # emit album_release CollectionEvent on the first successful finalize only.
    # deferred from create_album so a total upload failure doesn't publish a
    # fake release event. deduped by checking for any existing event.
    existing_event = await db.execute(
        select(CollectionEvent).where(
            CollectionEvent.album_id == album_id,
            CollectionEvent.event_type == "album_release",
        )
    )
    if not existing_event.scalar_one_or_none():
        db.add(
            CollectionEvent(
                event_type="album_release",
                actor_did=auth_session.did,
                album_id=album_id,
            )
        )

    await db.commit()

    await invalidate_album_cache(auth_session.handle, album.slug)

    artist_result = await db.execute(
        select(Artist).where(Artist.did == album.artist_did)
    )
    artist = artist_result.scalar_one()
    track_count, total_plays = await _album_stats(db, album_id)
    return await _album_metadata(album, artist, track_count, total_plays)


@router.patch("/{album_id}")
async def update_album(
    album_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Annotated[AuthSession, Depends(require_artist_profile)],
    title: Annotated[str | None, Query(description="new album title")] = None,
    description: Annotated[
        str | None, Query(description="new album description")
    ] = None,
) -> AlbumMetadata:
    """update album metadata (title, description). syncs ATProto records on title change."""
    from backend._internal.atproto.records.fm_plyr.list import update_list_record
    from backend._internal.atproto.records.fm_plyr.track import (
        build_track_record,
        update_record,
    )

    result = await db.execute(
        select(Album)
        .where(Album.id == album_id)
        .options(selectinload(Album.tracks).selectinload(Track.artist))
    )
    album = result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=404, detail="album not found")
    if album.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403, detail="you can only update your own albums"
        )

    old_title = album.title
    old_slug = album.slug
    title_changed = title is not None and title.strip() != old_title

    if title is not None:
        album.title = title.strip()
        # sync slug when title changes so get_or_create_album lookups work
        if title_changed:
            album.slug = slugify(title.strip())
    if description is not None:
        album.description = description.strip() if description.strip() else None

    # if title changed, update all tracks' extra["album"] and ATProto records
    if title_changed and title is not None:
        new_title = title.strip()

        for track in album.tracks:
            # update the track's extra["album"] field
            if track.extra is None:
                track.extra = {}
            track.extra = {**track.extra, "album": new_title}

            # update ATProto record if track has one
            if track.atproto_record_uri and track.r2_url and track.file_type:
                updated_record = build_track_record(
                    title=track.title,
                    artist=track.artist.display_name,
                    audio_url=track.r2_url,
                    file_type=track.file_type,
                    album=new_title,
                    duration=track.duration,
                    features=track.features if track.features else None,
                    image_url=await track.get_image_url(),
                )

                _, new_cid = await update_record(
                    auth_session=auth_session,
                    record_uri=track.atproto_record_uri,
                    record=updated_record,
                )
                track.atproto_record_cid = new_cid

        # update the album's ATProto list record name
        if album.atproto_record_uri:
            track_refs = [
                {"uri": t.atproto_record_uri, "cid": t.atproto_record_cid}
                for t in album.tracks
                if t.atproto_record_uri and t.atproto_record_cid
            ]
            _, new_list_cid = await update_list_record(
                auth_session=auth_session,
                list_uri=album.atproto_record_uri,
                items=track_refs,
                name=new_title,
                list_type="album",
                created_at=album.created_at,
            )
            album.atproto_record_cid = new_list_cid

    await db.commit()

    # invalidate cache for old slug (new slug will be a cache miss)
    await invalidate_album_cache(auth_session.handle, old_slug)
    if album.slug != old_slug:
        await invalidate_album_cache(auth_session.handle, album.slug)

    # fetch artist for response
    artist_result = await db.execute(
        select(Artist).where(Artist.did == album.artist_did)
    )
    artist = artist_result.scalar_one()
    track_count, total_plays = await _album_stats(db, album_id)

    return await _album_metadata(album, artist, track_count, total_plays)


@router.delete("/{album_id}/tracks/{track_id}")
async def remove_track_from_album(
    album_id: str,
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Annotated[AuthSession, Depends(require_artist_profile)],
) -> RemoveTrackFromAlbumResponse:
    """remove a track from an album (orphan it, don't delete).

    the track remains available as a standalone track.
    """
    # verify album exists and belongs to the authenticated artist
    album_result = await db.execute(select(Album).where(Album.id == album_id))
    album = album_result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=404, detail="album not found")
    if album.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403, detail="you can only modify your own albums"
        )

    # verify track exists and is in this album
    track_result = await db.execute(select(Track).where(Track.id == track_id))
    track = track_result.scalar_one_or_none()
    if not track:
        raise HTTPException(status_code=404, detail="track not found")
    if track.album_id != album_id:
        raise HTTPException(status_code=400, detail="track is not in this album")

    # orphan the track
    track.album_id = None
    await db.commit()

    await invalidate_album_cache(auth_session.handle, album.slug)

    return RemoveTrackFromAlbumResponse(track_id=track_id)


@router.delete("/{album_id}")
async def delete_album(
    album_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: Annotated[AuthSession, Depends(require_artist_profile)],
    cascade: Annotated[
        bool,
        Query(description="if true, also delete all tracks in the album"),
    ] = False,
) -> DeleteAlbumResponse:
    """delete album. tracks are orphaned unless cascade=true. removes ATProto list record."""
    from backend._internal.atproto.records import delete_record_by_uri

    # verify album exists and belongs to the authenticated artist
    result = await db.execute(select(Album).where(Album.id == album_id))
    album = result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=404, detail="album not found")
    if album.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403, detail="you can only delete your own albums"
        )

    # handle tracks
    if cascade:
        # delete all tracks in album
        from backend.api.tracks.mutations import delete_track

        tracks_result = await db.execute(
            select(Track).where(Track.album_id == album_id)
        )
        tracks = tracks_result.scalars().all()
        for track in tracks:
            try:
                await delete_track(track.id, db, auth_session)
            except Exception as e:
                logger.warning(f"failed to delete track {track.id}: {e}")
    else:
        # orphan tracks - set album_id to null
        from sqlalchemy import update

        await db.execute(
            update(Track).where(Track.album_id == album_id).values(album_id=None)
        )

    # delete ATProto record if exists
    if album.atproto_record_uri:
        try:
            await delete_record_by_uri(auth_session, album.atproto_record_uri)
        except Exception as e:
            logger.warning(f"failed to delete ATProto record: {e}")
            # continue with database cleanup even if ATProto delete fails

    # delete cover image from storage if exists
    if album.image_id:
        with contextlib.suppress(Exception):
            if album.image_url:
                await storage.delete_image(album.image_id, album.image_url)
            else:
                await storage.delete(album.image_id)

    # capture slug before deletion
    album_slug = album.slug

    # delete album from database
    await db.delete(album)
    await db.commit()

    # invalidate cache after commit so concurrent reads can't re-populate from pre-delete state
    await invalidate_album_cache(auth_session.handle, album_slug)

    return DeleteAlbumResponse(cascade=cascade)
