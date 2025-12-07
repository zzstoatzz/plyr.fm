"""lists api endpoints for ATProto list records."""

import contextlib
import logging
from io import BytesIO
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.atproto.records import (
    _reconstruct_oauth_session,
    _refresh_session_tokens,
    create_list_record,
    update_list_record,
)
from backend.models import Artist, Playlist, Track, TrackLike, UserPreferences, get_db
from backend.schemas import TrackResponse
from backend.storage import storage
from backend.utilities.aggregations import get_comment_counts, get_like_counts
from backend.utilities.hashing import CHUNK_SIZE

logger = logging.getLogger(__name__)


# --- playlist schemas ---


class CreatePlaylistRequest(BaseModel):
    """request body for creating a playlist."""

    name: str
    """display name for the playlist."""


class PlaylistResponse(BaseModel):
    """playlist metadata response."""

    id: str
    name: str
    owner_did: str
    owner_handle: str
    track_count: int
    image_url: str | None
    show_on_profile: bool
    atproto_record_uri: str
    created_at: str


class PlaylistWithTracksResponse(PlaylistResponse):
    """playlist with full track details."""

    tracks: list[TrackResponse]
    """ordered list of track details."""


class AddTrackRequest(BaseModel):
    """request body for adding a track to a playlist."""

    track_uri: str
    """ATProto URI of the track to add."""
    track_cid: str
    """CID of the track to add."""


router = APIRouter(prefix="/lists", tags=["lists"])


class ReorderRequest(BaseModel):
    """request body for reordering list items."""

    items: list[dict[str, str]]
    """ordered array of strongRefs (uri + cid). array order = display order."""


class ReorderResponse(BaseModel):
    """response from reorder operation."""

    uri: str
    cid: str


@router.put("/liked/reorder")
async def reorder_liked_list(
    body: ReorderRequest,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> ReorderResponse:
    """reorder items in the user's liked tracks list.

    the items array order becomes the new display order.
    only the list owner can reorder their own list.
    """
    # get the user's liked list URI from preferences
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.did == session.did)
    )
    prefs = prefs_result.scalar_one_or_none()

    if not prefs or not prefs.liked_list_uri:
        raise HTTPException(
            status_code=404,
            detail="liked list not found - try liking a track first",
        )

    # reconstruct OAuth session for ATProto operations
    oauth_data = session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise HTTPException(status_code=401, detail="invalid session")

    oauth_session = _reconstruct_oauth_session(oauth_data)

    # update the list record with new item order
    for attempt in range(2):
        try:
            uri, cid = await update_list_record(
                auth_session=session,
                list_uri=prefs.liked_list_uri,
                items=body.items,
                list_type="liked",
            )
            return ReorderResponse(uri=uri, cid=cid)

        except Exception as e:
            error_str = str(e).lower()
            # token expired - refresh and retry
            if "expired" in error_str and attempt == 0:
                oauth_session = await _refresh_session_tokens(session, oauth_session)
                continue
            raise HTTPException(
                status_code=500, detail=f"failed to reorder list: {e}"
            ) from e

    raise HTTPException(status_code=500, detail="failed to reorder list after retry")


@router.put("/{rkey}/reorder")
async def reorder_list(
    rkey: str,
    body: ReorderRequest,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> ReorderResponse:
    """reorder items in a list by rkey.

    the items array order becomes the new display order.
    only the list owner can reorder their own list.

    the rkey is the last segment of the AT URI (at://did/collection/rkey).
    """
    from backend.config import settings

    # construct the full AT URI
    list_uri = f"at://{session.did}/{settings.atproto.list_collection}/{rkey}"

    # reconstruct OAuth session for ATProto operations
    oauth_data = session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise HTTPException(status_code=401, detail="invalid session")

    oauth_session = _reconstruct_oauth_session(oauth_data)

    # update the list record with new item order
    for attempt in range(2):
        try:
            uri, cid = await update_list_record(
                auth_session=session,
                list_uri=list_uri,
                items=body.items,
            )
            return ReorderResponse(uri=uri, cid=cid)

        except Exception as e:
            error_str = str(e).lower()
            # token expired - refresh and retry
            if "expired" in error_str and attempt == 0:
                oauth_session = await _refresh_session_tokens(session, oauth_session)
                continue
            raise HTTPException(
                status_code=500, detail=f"failed to reorder list: {e}"
            ) from e

    raise HTTPException(status_code=500, detail="failed to reorder generic list")


# --- playlist CRUD endpoints ---


@router.post("/playlists", response_model=PlaylistResponse)
async def create_playlist(
    body: CreatePlaylistRequest,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """create a new playlist.

    creates an ATProto list record with listType="playlist" and caches
    metadata in the database for fast indexing.
    """
    # create ATProto list record
    try:
        uri, cid = await create_list_record(
            auth_session=session,
            items=[],
            name=body.name,
            list_type="playlist",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to create playlist: {e}"
        ) from e

    # get owner handle for response
    artist_result = await db.execute(select(Artist).where(Artist.did == session.did))
    artist = artist_result.scalar_one_or_none()
    owner_handle = artist.handle if artist else session.handle

    # cache playlist in database
    playlist = Playlist(
        owner_did=session.did,
        name=body.name,
        atproto_record_uri=uri,
        atproto_record_cid=cid,
        track_count=0,
    )
    db.add(playlist)
    await db.commit()
    await db.refresh(playlist)

    return PlaylistResponse(
        id=playlist.id,
        name=playlist.name,
        owner_did=playlist.owner_did,
        owner_handle=owner_handle,
        track_count=playlist.track_count,
        image_url=playlist.image_url,
        show_on_profile=playlist.show_on_profile,
        atproto_record_uri=playlist.atproto_record_uri,
        created_at=playlist.created_at.isoformat(),
    )


@router.get("/playlists", response_model=list[PlaylistResponse])
async def list_playlists(
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> list[PlaylistResponse]:
    """list all playlists owned by the current user."""
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.owner_did == session.did)
        .order_by(Playlist.created_at.desc())
    )
    rows = result.all()

    return [
        PlaylistResponse(
            id=playlist.id,
            name=playlist.name,
            owner_did=playlist.owner_did,
            owner_handle=artist.handle,
            track_count=playlist.track_count,
            image_url=playlist.image_url,
            show_on_profile=playlist.show_on_profile,
            atproto_record_uri=playlist.atproto_record_uri,
            created_at=playlist.created_at.isoformat(),
        )
        for playlist, artist in rows
    ]


@router.get("/playlists/by-artist/{artist_did}", response_model=list[PlaylistResponse])
async def list_artist_public_playlists(
    artist_did: str,
    db: AsyncSession = Depends(get_db),
) -> list[PlaylistResponse]:
    """list public playlists for an artist (no auth required).

    returns playlists where show_on_profile is true.
    used to display collections on artist profile pages.
    """
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.owner_did == artist_did)
        .where(Playlist.show_on_profile == True)  # noqa: E712
        .order_by(Playlist.created_at.desc())
    )
    rows = result.all()

    return [
        PlaylistResponse(
            id=playlist.id,
            name=playlist.name,
            owner_did=playlist.owner_did,
            owner_handle=artist.handle,
            track_count=playlist.track_count,
            image_url=playlist.image_url,
            show_on_profile=playlist.show_on_profile,
            atproto_record_uri=playlist.atproto_record_uri,
            created_at=playlist.created_at.isoformat(),
        )
        for playlist, artist in rows
    ]


@router.get("/playlists/{playlist_id}/meta", response_model=PlaylistResponse)
async def get_playlist_meta(
    playlist_id: str,
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """get playlist metadata (public, no auth required).

    used for link previews and og tags.
    """
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.id == playlist_id)
    )
    row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="playlist not found")

    playlist, artist = row

    return PlaylistResponse(
        id=playlist.id,
        name=playlist.name,
        owner_did=playlist.owner_did,
        owner_handle=artist.handle,
        track_count=playlist.track_count,
        image_url=playlist.image_url,
        show_on_profile=playlist.show_on_profile,
        atproto_record_uri=playlist.atproto_record_uri,
        created_at=playlist.created_at.isoformat(),
    )


@router.get("/playlists/{playlist_id}", response_model=PlaylistWithTracksResponse)
async def get_playlist(
    playlist_id: str,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistWithTracksResponse:
    """get a playlist with full track details.

    fetches the ATProto list record to get track ordering, then hydrates
    track metadata from the database.
    """
    # get playlist from database
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.id == playlist_id)
    )
    row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="playlist not found")

    playlist, artist = row

    # fetch ATProto list record to get track ordering
    oauth_data = session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise HTTPException(status_code=401, detail="invalid session")

    oauth_session = _reconstruct_oauth_session(oauth_data)
    from backend._internal import get_oauth_client

    # parse the AT URI to get repo and rkey
    parts = playlist.atproto_record_uri.replace("at://", "").split("/")
    if len(parts) != 3:
        raise HTTPException(status_code=500, detail="invalid playlist URI")

    repo, collection, rkey = parts

    # get the list record from PDS
    url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.getRecord"
    params = {"repo": repo, "collection": collection, "rkey": rkey}

    response = await get_oauth_client().make_authenticated_request(
        session=oauth_session,
        method="GET",
        url=url,
        params=params,
    )

    if response.status_code != 200:
        raise HTTPException(status_code=500, detail="failed to fetch playlist record")

    record_data = response.json()
    items = record_data.get("value", {}).get("items", [])

    # extract track URIs in order
    track_uris = [item.get("subject", {}).get("uri") for item in items]
    track_uris = [uri for uri in track_uris if uri]

    # hydrate track metadata from database
    tracks: list[TrackResponse] = []
    if track_uris:
        from sqlalchemy.orm import selectinload

        track_result = await db.execute(
            select(Track)
            .options(selectinload(Track.artist), selectinload(Track.album_rel))
            .where(Track.atproto_record_uri.in_(track_uris))
        )
        all_tracks = track_result.scalars().all()
        track_by_uri = {t.atproto_record_uri: t for t in all_tracks}

        # get track IDs for aggregation queries
        track_ids = [t.id for t in all_tracks]
        like_counts = await get_like_counts(db, track_ids) if track_ids else {}
        comment_counts = await get_comment_counts(db, track_ids) if track_ids else {}

        # get authenticated user's liked tracks
        liked_track_ids: set[int] = set()
        if track_ids:
            liked_result = await db.execute(
                select(TrackLike.track_id).where(
                    TrackLike.user_did == session.did,
                    TrackLike.track_id.in_(track_ids),
                )
            )
            liked_track_ids = set(liked_result.scalars().all())

        # maintain ATProto ordering
        for uri in track_uris:
            if uri in track_by_uri:
                track = track_by_uri[uri]
                track_response = await TrackResponse.from_track(
                    track,
                    pds_url=oauth_data.get("pds_url"),
                    liked_track_ids=liked_track_ids,
                    like_counts=like_counts,
                    comment_counts=comment_counts,
                )
                tracks.append(track_response)

    return PlaylistWithTracksResponse(
        id=playlist.id,
        name=playlist.name,
        owner_did=playlist.owner_did,
        owner_handle=artist.handle,
        track_count=len(tracks),
        image_url=playlist.image_url,
        show_on_profile=playlist.show_on_profile,
        atproto_record_uri=playlist.atproto_record_uri,
        created_at=playlist.created_at.isoformat(),
        tracks=tracks,
    )


@router.post("/playlists/{playlist_id}/tracks", response_model=PlaylistResponse)
async def add_track_to_playlist(
    playlist_id: str,
    body: AddTrackRequest,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """add a track to a playlist.

    appends the track to the end of the playlist's ATProto list record
    and updates the cached track count.
    """
    # get playlist and verify ownership
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.id == playlist_id)
    )
    row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="playlist not found")

    playlist, artist = row

    if playlist.owner_did != session.did:
        raise HTTPException(status_code=403, detail="not playlist owner")

    # fetch current list record
    oauth_data = session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise HTTPException(status_code=401, detail="invalid session")

    oauth_session = _reconstruct_oauth_session(oauth_data)
    from backend._internal import get_oauth_client

    parts = playlist.atproto_record_uri.replace("at://", "").split("/")
    repo, collection, rkey = parts

    url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.getRecord"
    params = {"repo": repo, "collection": collection, "rkey": rkey}

    response = await get_oauth_client().make_authenticated_request(
        session=oauth_session,
        method="GET",
        url=url,
        params=params,
    )

    if response.status_code != 200:
        raise HTTPException(status_code=500, detail="failed to fetch playlist record")

    record_data = response.json()
    current_items = record_data.get("value", {}).get("items", [])

    # check if track already exists in playlist
    for item in current_items:
        if item.get("subject", {}).get("uri") == body.track_uri:
            raise HTTPException(status_code=400, detail="track already in playlist")

    # append new track
    new_items = [
        {"uri": item["subject"]["uri"], "cid": item["subject"]["cid"]}
        for item in current_items
    ]
    new_items.append({"uri": body.track_uri, "cid": body.track_cid})

    # update ATProto record
    try:
        _, cid = await update_list_record(
            auth_session=session,
            list_uri=playlist.atproto_record_uri,
            items=new_items,
            name=playlist.name,
            list_type="playlist",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to update playlist: {e}"
        ) from e

    # update database cache
    playlist.atproto_record_cid = cid
    playlist.track_count = len(new_items)
    await db.commit()
    await db.refresh(playlist)

    return PlaylistResponse(
        id=playlist.id,
        name=playlist.name,
        owner_did=playlist.owner_did,
        owner_handle=artist.handle,
        track_count=playlist.track_count,
        image_url=playlist.image_url,
        show_on_profile=playlist.show_on_profile,
        atproto_record_uri=playlist.atproto_record_uri,
        created_at=playlist.created_at.isoformat(),
    )


@router.delete("/playlists/{playlist_id}/tracks/{track_uri:path}")
async def remove_track_from_playlist(
    playlist_id: str,
    track_uri: str,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """remove a track from a playlist."""
    # get playlist and verify ownership
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.id == playlist_id)
    )
    row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="playlist not found")

    playlist, artist = row

    if playlist.owner_did != session.did:
        raise HTTPException(status_code=403, detail="not playlist owner")

    # fetch current list record
    oauth_data = session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise HTTPException(status_code=401, detail="invalid session")

    oauth_session = _reconstruct_oauth_session(oauth_data)
    from backend._internal import get_oauth_client

    parts = playlist.atproto_record_uri.replace("at://", "").split("/")
    repo, collection, rkey = parts

    url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.getRecord"
    params = {"repo": repo, "collection": collection, "rkey": rkey}

    response = await get_oauth_client().make_authenticated_request(
        session=oauth_session,
        method="GET",
        url=url,
        params=params,
    )

    if response.status_code != 200:
        raise HTTPException(status_code=500, detail="failed to fetch playlist record")

    record_data = response.json()
    current_items = record_data.get("value", {}).get("items", [])

    # filter out the track to remove
    new_items = [
        {"uri": item["subject"]["uri"], "cid": item["subject"]["cid"]}
        for item in current_items
        if item.get("subject", {}).get("uri") != track_uri
    ]

    if len(new_items) == len(current_items):
        raise HTTPException(status_code=404, detail="track not in playlist")

    # update ATProto record
    try:
        _, cid = await update_list_record(
            auth_session=session,
            list_uri=playlist.atproto_record_uri,
            items=new_items,
            name=playlist.name,
            list_type="playlist",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to update playlist: {e}"
        ) from e

    # update database cache
    playlist.atproto_record_cid = cid
    playlist.track_count = len(new_items)
    await db.commit()
    await db.refresh(playlist)

    return PlaylistResponse(
        id=playlist.id,
        name=playlist.name,
        owner_did=playlist.owner_did,
        owner_handle=artist.handle,
        track_count=playlist.track_count,
        image_url=playlist.image_url,
        show_on_profile=playlist.show_on_profile,
        atproto_record_uri=playlist.atproto_record_uri,
        created_at=playlist.created_at.isoformat(),
    )


@router.delete("/playlists/{playlist_id}")
async def delete_playlist(
    playlist_id: str,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """delete a playlist.

    deletes both the ATProto list record and the database cache.
    """
    from backend._internal.atproto.records import delete_record_by_uri

    # get playlist and verify ownership
    result = await db.execute(select(Playlist).where(Playlist.id == playlist_id))
    playlist = result.scalar_one_or_none()

    if not playlist:
        raise HTTPException(status_code=404, detail="playlist not found")

    if playlist.owner_did != session.did:
        raise HTTPException(status_code=403, detail="not playlist owner")

    # delete ATProto record
    try:
        await delete_record_by_uri(session, playlist.atproto_record_uri)
    except Exception as e:
        logger.warning(f"failed to delete ATProto record: {e}")
        # continue with database cleanup even if ATProto delete fails

    # delete from database
    await db.delete(playlist)
    await db.commit()

    return {"deleted": True}


@router.post("/playlists/{playlist_id}/cover")
async def upload_playlist_cover(
    playlist_id: str,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
    image: UploadFile = File(...),
) -> dict[str, str | None]:
    """upload cover art for a playlist (requires authentication).

    accepts jpg, jpeg, png, webp images up to 20MB.
    """
    # verify playlist exists and belongs to the authenticated user
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.id == playlist_id)
    )
    row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="playlist not found")

    playlist, _artist = row

    if playlist.owner_did != session.did:
        raise HTTPException(
            status_code=403,
            detail="you can only upload cover art for your own playlists",
        )

    if not image.filename:
        raise HTTPException(status_code=400, detail="no filename provided")

    # validate it's an image by extension
    ext = Path(image.filename).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported image type: {ext}. supported: .jpg, .jpeg, .png, .webp",
        )

    # read image data (enforcing size limit)
    try:
        max_image_size = 20 * 1024 * 1024  # 20MB max
        image_data = bytearray()

        while chunk := await image.read(CHUNK_SIZE):
            if len(image_data) + len(chunk) > max_image_size:
                raise HTTPException(
                    status_code=413,
                    detail="image too large (max 20MB)",
                )
            image_data.extend(chunk)

        image_obj = BytesIO(image_data)
        # save returns the file_id (hash)
        image_id = await storage.save(image_obj, image.filename)

        # construct R2 URL directly (images are stored under images/ prefix)
        image_url = f"{storage.public_image_bucket_url}/images/{image_id}{ext}"

        # delete old image if exists (prevent R2 object leaks)
        if playlist.image_id:
            with contextlib.suppress(Exception):
                await storage.delete(playlist.image_id)

        # update playlist with new image
        playlist.image_id = image_id
        playlist.image_url = image_url
        await db.commit()

        return {"image_url": image_url, "image_id": image_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"failed to upload playlist cover: {e}")
        raise HTTPException(
            status_code=500, detail="failed to upload cover image"
        ) from e


@router.patch("/playlists/{playlist_id}")
async def update_playlist(
    playlist_id: str,
    name: Annotated[str | None, Form()] = None,
    show_on_profile: Annotated[bool | None, Form()] = None,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """update playlist metadata (name, show_on_profile).

    use POST /playlists/{id}/cover to update cover art separately.
    """
    # verify playlist exists and belongs to the authenticated user
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.id == playlist_id)
    )
    row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="playlist not found")

    playlist, artist = row

    if playlist.owner_did != session.did:
        raise HTTPException(status_code=403, detail="not playlist owner")

    # update show_on_profile if provided
    if show_on_profile is not None:
        playlist.show_on_profile = show_on_profile

    # update name if provided
    if name is not None and name.strip():
        playlist.name = name.strip()

        # also update the ATProto record with new name
        try:
            # fetch current list record to preserve items
            oauth_data = session.oauth_session
            if oauth_data and "access_token" in oauth_data:
                from backend._internal import get_oauth_client

                oauth_session = _reconstruct_oauth_session(oauth_data)

                parts = playlist.atproto_record_uri.replace("at://", "").split("/")
                repo, collection, rkey = parts

                url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.getRecord"
                params = {"repo": repo, "collection": collection, "rkey": rkey}

                response = await get_oauth_client().make_authenticated_request(
                    session=oauth_session,
                    method="GET",
                    url=url,
                    params=params,
                )

                if response.status_code == 200:
                    record_data = response.json()
                    current_items = record_data.get("value", {}).get("items", [])

                    # update list record with new name
                    items = [
                        {"uri": item["subject"]["uri"], "cid": item["subject"]["cid"]}
                        for item in current_items
                    ]
                    _, cid = await update_list_record(
                        auth_session=session,
                        list_uri=playlist.atproto_record_uri,
                        items=items,
                        name=playlist.name,
                        list_type="playlist",
                    )
                    playlist.atproto_record_cid = cid
        except Exception as e:
            logger.warning(f"failed to update ATProto record name: {e}")
            # continue - local update is still valid

    await db.commit()
    await db.refresh(playlist)

    return PlaylistResponse(
        id=playlist.id,
        name=playlist.name,
        owner_did=playlist.owner_did,
        owner_handle=artist.handle,
        track_count=playlist.track_count,
        image_url=playlist.image_url,
        show_on_profile=playlist.show_on_profile,
        atproto_record_uri=playlist.atproto_record_uri,
        created_at=playlist.created_at.isoformat(),
    )
