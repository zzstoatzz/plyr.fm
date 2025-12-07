"""lists api endpoints for ATProto list records."""

import logging

from fastapi import APIRouter, Depends, HTTPException
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
from backend.models import Artist, Playlist, Track, UserPreferences, get_db

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
    atproto_record_uri: str
    created_at: str


class PlaylistWithTracksResponse(PlaylistResponse):
    """playlist with full track details."""

    tracks: list[dict]
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
            atproto_record_uri=playlist.atproto_record_uri,
            created_at=playlist.created_at.isoformat(),
        )
        for playlist, artist in rows
    ]


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
    tracks = []
    if track_uris:
        track_result = await db.execute(
            select(Track, Artist)
            .join(Artist, Track.artist_did == Artist.did)
            .where(Track.atproto_record_uri.in_(track_uris))
        )
        track_rows = {t.atproto_record_uri: (t, a) for t, a in track_result.all()}

        # maintain ATProto ordering
        for uri in track_uris:
            if uri in track_rows:
                track, track_artist = track_rows[uri]
                tracks.append(
                    {
                        "id": track.id,
                        "title": track.title,
                        "artist_name": track_artist.display_name,
                        "artist_handle": track_artist.handle,
                        "artist_did": track_artist.did,
                        "duration": track.duration,
                        "image_url": track.image_url,
                        "atproto_record_uri": track.atproto_record_uri,
                        "atproto_record_cid": track.atproto_record_cid,
                    }
                )

    return PlaylistWithTracksResponse(
        id=playlist.id,
        name=playlist.name,
        owner_did=playlist.owner_did,
        owner_handle=artist.handle,
        track_count=len(tracks),
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
