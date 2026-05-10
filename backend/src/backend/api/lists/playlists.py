"""playlist CRUD endpoints.

playlists come in two flavors:

* **public** — cached metadata for an ATProto list record on the user's PDS.
  `atproto_record_uri` is the source of truth for items.
* **private** — owner-only, not pushed to the PDS. items live inline in
  `items_json` on the playlists row. app-layer privacy until atproto's
  permissioned-data substrate ships (see #1384).

every privacy gate must produce **404 (not 403)** for non-owners on a
private playlist, so existence isn't leaked. consistent with how the
permissioned-data spec describes reader-side enforcement, even though
we're not on that substrate yet.
"""

import contextlib
import json
import logging
from typing import Annotated

from fastapi import Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session as AuthSession
from backend._internal import get_oauth_client, get_optional_session, require_auth
from backend._internal.atproto.client import parse_at_uri
from backend._internal.atproto.records import (
    RecordNotFound,
    _reconstruct_oauth_session,
    create_list_record,
    delete_record_by_uri,
    fetch_list_item_uris,
    update_list_record,
)
from backend._internal.image_uploads import COVER_EXTENSIONS, process_image_upload
from backend._internal.recommendations import get_playlist_recommendations
from backend.config import settings
from backend.models import (
    Artist,
    CollectionEvent,
    Playlist,
    Track,
    get_db,
)
from backend.schemas import DeletedResponse
from backend.storage import storage
from backend.utilities.redis import get_async_redis_client

from .hydration import hydrate_tracks_from_uris
from .router import router
from .schemas import (
    AddTrackRequest,
    CreatePlaylistRequest,
    PlaylistRecommendationsResponse,
    PlaylistResponse,
    PlaylistWithTracksResponse,
    RecommendedTrack,
    ReorderRequest,
)

logger = logging.getLogger(__name__)


def _build_playlist_response(playlist: Playlist, owner_handle: str) -> PlaylistResponse:
    """common projection from Playlist row → API response.

    `track_count` reflects the cached value on the row. for full-playlist
    responses where we've actually hydrated tracks, use
    `_build_playlist_with_tracks` so the count matches the rendered list
    even if the cache is stale or some referenced tracks weren't hydratable.
    """
    return PlaylistResponse(
        id=playlist.id,
        name=playlist.name,
        owner_did=playlist.owner_did,
        owner_handle=owner_handle,
        track_count=playlist.track_count,
        image_url=playlist.image_url,
        show_on_profile=playlist.show_on_profile,
        atproto_record_uri=playlist.atproto_record_uri,
        is_private=playlist.is_private,
        created_at=playlist.created_at.isoformat(),
    )


def _build_playlist_with_tracks(
    playlist: Playlist,
    owner_handle: str,
    tracks: list,
) -> PlaylistWithTracksResponse:
    """projection for full responses — overrides `track_count` to match
    the actually-hydrated `tracks` list, since the cached count can lag
    behind PDS state and may not match what the client renders."""
    base = _build_playlist_response(playlist, owner_handle).model_dump()
    base["track_count"] = len(tracks)
    return PlaylistWithTracksResponse(**base, tracks=tracks)


def _assert_can_mutate(session: AuthSession, playlist: Playlist) -> None:
    """raise the right HTTPException if `session` can't mutate `playlist`.

    public: non-owner gets 403 ("you can't edit this — it exists, but not yours").
    private: non-owner gets 404 — must be indistinguishable from "doesn't exist"
    so existence isn't leaked.
    """
    if playlist.owner_did != session.did:
        if playlist.is_private:
            raise HTTPException(status_code=404, detail="playlist not found")
        raise HTTPException(status_code=403, detail="not playlist owner")


def _can_view(session_did: str | None, playlist: Playlist) -> bool:
    """can this viewer see this playlist? public: anyone. private: owner only."""
    return not playlist.is_private or session_did == playlist.owner_did


async def _snapshot_pds_items(
    session: AuthSession, playlist: Playlist
) -> list[dict[str, str]]:
    """fetch the playlist's current items from the PDS list record as
    `[{uri, cid}, ...]`. used when transitioning public → private to
    preserve item ordering + cids in `items_json`.
    """
    if not playlist.atproto_record_uri:
        return []

    oauth_data = session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise HTTPException(status_code=401, detail="invalid session")

    oauth_session = _reconstruct_oauth_session(oauth_data)
    repo, collection, rkey = parse_at_uri(playlist.atproto_record_uri)
    url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.getRecord"
    response = await get_oauth_client().make_authenticated_request(
        session=oauth_session,
        method="GET",
        url=url,
        params={"repo": repo, "collection": collection, "rkey": rkey},
    )
    if response.status_code != 200:
        raise HTTPException(
            status_code=502, detail="failed to read playlist record from PDS"
        )

    items = response.json().get("value", {}).get("items", [])
    return [
        {"uri": item["subject"]["uri"], "cid": item["subject"]["cid"]}
        for item in items
        if item.get("subject", {}).get("uri")
    ]


async def _make_playlist_public(session: AuthSession, playlist: Playlist) -> None:
    """transition private → public.

    1. write items_json to a new ATProto list record on the user's PDS
    2. update the row to reference the new record, clear items_json,
       set is_private=false, and reset show_on_profile=false (visibility
       changed; the user opts back in if they want it on their profile)

    raises if the PDS write fails — the row stays private, no detritus.
    """
    items = list(playlist.items_json or [])
    try:
        uri, cid = await create_list_record(
            auth_session=session,
            items=items,
            name=playlist.name,
            list_type="playlist",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to publish playlist: {e}"
        ) from e

    playlist.atproto_record_uri = uri
    playlist.atproto_record_cid = cid
    playlist.items_json = None
    playlist.is_private = False
    playlist.show_on_profile = False
    playlist.track_count = len(items)


async def _make_playlist_private(session: AuthSession, playlist: Playlist) -> None:
    """transition public → private.

    1. snapshot current PDS items into items_json (preserves ordering + cids)
    2. flip the row to private and clear the PDS-record fields
    3. best-effort delete the PDS record (logged-and-continue if it fails;
       user-facing state is already correct, the public record is detritus)
    """
    items = await _snapshot_pds_items(session, playlist)
    public_uri = playlist.atproto_record_uri

    playlist.items_json = items
    playlist.is_private = True
    playlist.atproto_record_uri = None
    playlist.atproto_record_cid = None
    playlist.show_on_profile = False
    playlist.track_count = len(items)

    if public_uri:
        try:
            await delete_record_by_uri(session, public_uri)
        except Exception as e:
            logger.warning(
                "made playlist %s private but failed to delete PDS record %s: %s",
                playlist.id,
                public_uri,
                e,
            )


async def _read_playlist_items(
    playlist: Playlist, artist: Artist
) -> list[dict[str, str]]:
    """fetch playlist items as `[{uri, cid}, ...]`.

    private → items_json on the row; public → ATProto list record on the
    owner's PDS. raises RecordNotFound if the public PDS record is missing.
    """
    if playlist.is_private:
        return [
            {"uri": item["uri"], "cid": item.get("cid", "")}
            for item in (playlist.items_json or [])
            if item.get("uri")
        ]

    if not playlist.atproto_record_uri:
        return []
    uris = await fetch_list_item_uris(playlist.atproto_record_uri, artist.pds_url)
    return [{"uri": uri, "cid": ""} for uri in uris]


# --- playlist CRUD endpoints ---


@router.post("/playlists", response_model=PlaylistResponse)
async def create_playlist(
    body: CreatePlaylistRequest,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """create a new playlist.

    public: writes an ATProto list record to the user's PDS and caches
    metadata locally.

    private: skips the PDS write; items live inline in `items_json`.
    """
    artist_result = await db.execute(select(Artist).where(Artist.did == session.did))
    artist = artist_result.scalar_one_or_none()
    owner_handle = artist.handle if artist else session.handle

    if body.is_private:
        playlist = Playlist(
            owner_did=session.did,
            name=body.name,
            atproto_record_uri=None,
            atproto_record_cid=None,
            is_private=True,
            items_json=[],
            track_count=0,
        )
        db.add(playlist)
        await db.flush()
    else:
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

        playlist = Playlist(
            owner_did=session.did,
            name=body.name,
            atproto_record_uri=uri,
            atproto_record_cid=cid,
            is_private=False,
            track_count=0,
        )
        db.add(playlist)
        await db.flush()

        # only public creations enter the platform-wide activity feed
        db.add(
            CollectionEvent(
                event_type="playlist_create",
                actor_did=session.did,
                playlist_id=playlist.id,
            )
        )

    await db.commit()
    await db.refresh(playlist)

    return _build_playlist_response(playlist, owner_handle)


@router.get("/playlists", response_model=list[PlaylistResponse])
async def list_playlists(
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> list[PlaylistResponse]:
    """list all playlists (public + private) owned by the current user."""
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.owner_did == session.did)
        .order_by(Playlist.created_at.desc())
    )
    rows = result.all()
    return [
        _build_playlist_response(playlist, artist.handle) for playlist, artist in rows
    ]


@router.get("/playlists/by-artist/{artist_did}", response_model=list[PlaylistResponse])
async def list_artist_public_playlists(
    artist_did: str,
    db: AsyncSession = Depends(get_db),
) -> list[PlaylistResponse]:
    """list public playlists for an artist (no auth required).

    private playlists are excluded regardless of `show_on_profile`.
    """
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.owner_did == artist_did)
        .where(Playlist.show_on_profile == True)  # noqa: E712
        .where(Playlist.is_private == False)  # noqa: E712
        .order_by(Playlist.created_at.desc())
    )
    rows = result.all()
    return [
        _build_playlist_response(playlist, artist.handle) for playlist, artist in rows
    ]


@router.get("/playlists/by-uri", response_model=PlaylistWithTracksResponse)
async def get_playlist_by_uri(
    uri: Annotated[str, Query(description="AT-URI of the playlist list record")],
    db: AsyncSession = Depends(get_db),
    session: AuthSession | None = Depends(get_optional_session),
) -> PlaylistWithTracksResponse:
    """get a playlist by its ATProto record URI (public only).

    private playlists have no ATProto URI and cannot be looked up here.
    """
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.atproto_record_uri == uri)
    )
    row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="playlist not found")

    playlist, artist = row

    try:
        item_refs = await _read_playlist_items(playlist, artist)
    except RecordNotFound:
        raise HTTPException(
            status_code=404, detail="playlist record not found on PDS"
        ) from None
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to fetch playlist record: {e}"
        ) from e

    tracks = await hydrate_tracks_from_uris(
        db,
        [ref["uri"] for ref in item_refs],
        session_did=session.did if session else None,
    )

    return _build_playlist_with_tracks(playlist, artist.handle, tracks)


@router.get("/playlists/{playlist_id}/meta", response_model=PlaylistResponse)
async def get_playlist_meta(
    playlist_id: str,
    db: AsyncSession = Depends(get_db),
    session: AuthSession | None = Depends(get_optional_session),
) -> PlaylistResponse:
    """get playlist metadata. used for link previews.

    private playlists are 404 for non-owners — must not leak existence.
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

    if not _can_view(session.did if session else None, playlist):
        raise HTTPException(status_code=404, detail="playlist not found")

    return _build_playlist_response(playlist, artist.handle)


@router.get("/playlists/{playlist_id}", response_model=PlaylistWithTracksResponse)
async def get_playlist(
    playlist_id: str,
    db: AsyncSession = Depends(get_db),
    session: AuthSession | None = Depends(get_optional_session),
) -> PlaylistWithTracksResponse:
    """get a playlist with full track details.

    private playlists are 404 for non-owners — must not leak existence.
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

    if not _can_view(session.did if session else None, playlist):
        raise HTTPException(status_code=404, detail="playlist not found")

    try:
        item_refs = await _read_playlist_items(playlist, artist)
    except RecordNotFound:
        raise HTTPException(
            status_code=404, detail="playlist record not found on PDS"
        ) from None
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to fetch playlist record: {e}"
        ) from e

    tracks = await hydrate_tracks_from_uris(
        db,
        [ref["uri"] for ref in item_refs],
        session_did=session.did if session else None,
    )

    return _build_playlist_with_tracks(playlist, artist.handle, tracks)


@router.post("/playlists/{playlist_id}/tracks", response_model=PlaylistResponse)
async def add_track_to_playlist(
    playlist_id: str,
    body: AddTrackRequest,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """append a track to a playlist.

    public: rewrites the ATProto list record on the user's PDS.
    private: rewrites the inline `items_json` array.
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
    _assert_can_mutate(session, playlist)

    if playlist.is_private:
        current_items = list(playlist.items_json or [])
        if any(item.get("uri") == body.track_uri for item in current_items):
            raise HTTPException(status_code=400, detail="track already in playlist")
        new_items = [*current_items, {"uri": body.track_uri, "cid": body.track_cid}]
        playlist.items_json = new_items
        playlist.track_count = len(new_items)
    else:
        oauth_data = session.oauth_session
        if not oauth_data or "access_token" not in oauth_data:
            raise HTTPException(status_code=401, detail="invalid session")

        oauth_session = _reconstruct_oauth_session(oauth_data)

        repo, collection, rkey = parse_at_uri(playlist.atproto_record_uri)

        url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.getRecord"
        params = {"repo": repo, "collection": collection, "rkey": rkey}

        response = await get_oauth_client().make_authenticated_request(
            session=oauth_session,
            method="GET",
            url=url,
            params=params,
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=500, detail="failed to fetch playlist record"
            )

        record_data = response.json()
        current_items = record_data.get("value", {}).get("items", [])

        for item in current_items:
            if item.get("subject", {}).get("uri") == body.track_uri:
                raise HTTPException(status_code=400, detail="track already in playlist")

        new_items = [
            {"uri": item["subject"]["uri"], "cid": item["subject"]["cid"]}
            for item in current_items
        ]
        new_items.append({"uri": body.track_uri, "cid": body.track_cid})

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

        playlist.atproto_record_cid = cid
        playlist.track_count = len(new_items)

    if not playlist.is_private:
        # private additions don't go in the platform-wide activity feed
        track_result = await db.execute(
            select(Track.id).where(Track.atproto_record_uri == body.track_uri)
        )
        resolved_track_id = track_result.scalar_one_or_none()
        db.add(
            CollectionEvent(
                event_type="track_added_to_playlist",
                actor_did=session.did,
                playlist_id=playlist.id,
                track_id=resolved_track_id,
            )
        )

    await db.commit()
    await db.refresh(playlist)

    return _build_playlist_response(playlist, artist.handle)


@router.delete("/playlists/{playlist_id}/tracks/{track_uri:path}")
async def remove_track_from_playlist(
    playlist_id: str,
    track_uri: str,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """remove a track from a playlist."""
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.id == playlist_id)
    )
    row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="playlist not found")

    playlist, artist = row
    _assert_can_mutate(session, playlist)

    if playlist.is_private:
        current_items = list(playlist.items_json or [])
        new_items = [item for item in current_items if item.get("uri") != track_uri]
        if len(new_items) == len(current_items):
            raise HTTPException(status_code=404, detail="track not in playlist")
        playlist.items_json = new_items
        playlist.track_count = len(new_items)
    else:
        oauth_data = session.oauth_session
        if not oauth_data or "access_token" not in oauth_data:
            raise HTTPException(status_code=401, detail="invalid session")

        oauth_session = _reconstruct_oauth_session(oauth_data)

        repo, collection, rkey = parse_at_uri(playlist.atproto_record_uri)

        url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.getRecord"
        params = {"repo": repo, "collection": collection, "rkey": rkey}

        response = await get_oauth_client().make_authenticated_request(
            session=oauth_session,
            method="GET",
            url=url,
            params=params,
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=500, detail="failed to fetch playlist record"
            )

        record_data = response.json()
        current_items = record_data.get("value", {}).get("items", [])

        new_items = [
            {"uri": item["subject"]["uri"], "cid": item["subject"]["cid"]}
            for item in current_items
            if item.get("subject", {}).get("uri") != track_uri
        ]

        if len(new_items) == len(current_items):
            raise HTTPException(status_code=404, detail="track not in playlist")

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

        playlist.atproto_record_cid = cid
        playlist.track_count = len(new_items)

    await db.commit()
    await db.refresh(playlist)

    return _build_playlist_response(playlist, artist.handle)


@router.put("/playlists/{playlist_id}/reorder", response_model=PlaylistResponse)
async def reorder_playlist(
    playlist_id: str,
    body: ReorderRequest,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """reorder items in a playlist. items array order = new display order.

    routes to the ATProto list record (public) or `items_json` (private).
    owner-only.
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
    _assert_can_mutate(session, playlist)

    if playlist.is_private:
        new_items = [
            {"uri": item["uri"], "cid": item.get("cid", "")}
            for item in body.items
            if item.get("uri")
        ]
        playlist.items_json = new_items
        playlist.track_count = len(new_items)
    else:
        if not playlist.atproto_record_uri:
            raise HTTPException(
                status_code=500, detail="playlist has no backing record"
            )
        try:
            _, cid = await update_list_record(
                auth_session=session,
                list_uri=playlist.atproto_record_uri,
                items=body.items,
                name=playlist.name,
                list_type="playlist",
            )
            playlist.atproto_record_cid = cid
            playlist.track_count = len(body.items)
        except Exception as e:
            raise HTTPException(
                status_code=500, detail=f"failed to reorder playlist: {e}"
            ) from e

    await db.commit()
    await db.refresh(playlist)

    return _build_playlist_response(playlist, artist.handle)


@router.delete("/playlists/{playlist_id}")
async def delete_playlist(
    playlist_id: str,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> DeletedResponse:
    """delete a playlist.

    public: removes the ATProto list record and the local row.
    private: removes the local row only (no PDS record exists).
    """
    result = await db.execute(select(Playlist).where(Playlist.id == playlist_id))
    playlist = result.scalar_one_or_none()

    if not playlist:
        raise HTTPException(status_code=404, detail="playlist not found")

    _assert_can_mutate(session, playlist)

    if not playlist.is_private and playlist.atproto_record_uri:
        try:
            await delete_record_by_uri(session, playlist.atproto_record_uri)
        except Exception as e:
            logger.warning(f"failed to delete ATProto record: {e}")
            # continue with local cleanup even if ATProto delete fails

    await db.delete(playlist)
    await db.commit()

    return DeletedResponse()


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

    _assert_can_mutate(session, playlist)

    try:
        uploaded = await process_image_upload(
            image, "playlist", allowed_extensions=COVER_EXTENSIONS
        )

        # delete old image if exists (prevent R2 object leaks)
        if playlist.image_id and playlist.image_id != uploaded.image_id:
            with contextlib.suppress(Exception):
                if playlist.image_url:
                    await storage.delete_image(playlist.image_id, playlist.image_url)
                else:
                    await storage.delete(playlist.image_id)

        # update playlist with new image
        playlist.image_id = uploaded.image_id
        playlist.image_url = uploaded.image_url
        playlist.thumbnail_url = uploaded.thumbnail_url
        await db.commit()

        return {
            "image_url": uploaded.image_url,
            "image_id": uploaded.image_id,
            "thumbnail_url": uploaded.thumbnail_url,
        }

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
    is_private: Annotated[bool | None, Form()] = None,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """update playlist metadata (name, show_on_profile, is_private).

    use POST /playlists/{id}/cover to update cover art separately.

    toggling `is_private` runs a transition: private → public publishes
    a new ATProto list record on the user's PDS; public → private
    snapshots the PDS items into local storage and removes the PDS
    record. show_on_profile resets to false on either transition so the
    user opts back in for profile visibility after a privacy change.
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

    _assert_can_mutate(session, playlist)

    # privacy transition runs first — it can reset show_on_profile, which
    # the explicit show_on_profile arg below should then override if given
    if is_private is not None and is_private != playlist.is_private:
        if is_private:
            await _make_playlist_private(session, playlist)
        else:
            await _make_playlist_public(session, playlist)

    if show_on_profile is not None:
        playlist.show_on_profile = show_on_profile

    # update name if provided
    if name is not None and name.strip():
        playlist.name = name.strip()

        if not playlist.is_private and playlist.atproto_record_uri:
            # public playlists: also update the ATProto record's name field
            try:
                oauth_data = session.oauth_session
                if oauth_data and "access_token" in oauth_data:
                    oauth_session = _reconstruct_oauth_session(oauth_data)

                    repo, collection, rkey = parse_at_uri(playlist.atproto_record_uri)

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

                        items = [
                            {
                                "uri": item["subject"]["uri"],
                                "cid": item["subject"]["cid"],
                            }
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
                # continue — local update is still valid

    await db.commit()
    await db.refresh(playlist)

    return _build_playlist_response(playlist, artist.handle)


@router.get(
    "/playlists/{playlist_id}/recommendations",
    response_model=PlaylistRecommendationsResponse,
)
async def get_playlist_recommendations_endpoint(
    playlist_id: str,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(3, ge=1, le=10, description="max recommendations"),
) -> PlaylistRecommendationsResponse:
    """get track recommendations for a playlist.

    uses CLAP embeddings to find tracks similar to what's in the playlist.
    requires auth (owner only — recommendations are for editing).
    results are cached per playlist CID (auto-invalidates on track changes).
    """
    unavailable = PlaylistRecommendationsResponse(tracks=[], available=False)

    if not settings.turbopuffer.enabled:
        return unavailable

    # fetch playlist and verify ownership
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.id == playlist_id)
    )
    row = result.first()

    if not row:
        raise HTTPException(status_code=404, detail="playlist not found")

    playlist, artist = row

    _assert_can_mutate(session, playlist)

    if playlist.track_count == 0:
        return unavailable

    # cache token derived from CID for public, updated_at for private (no CID)
    cache_token = (
        playlist.atproto_record_cid
        if playlist.atproto_record_cid
        else playlist.updated_at.isoformat()
    )
    cache_key = f"plyr:recommendations:{playlist_id}:{cache_token}"

    try:
        redis = get_async_redis_client()
        cached = await redis.get(cache_key)
        if cached:
            data = json.loads(cached)
            return PlaylistRecommendationsResponse(**data)
    except Exception as e:
        logger.debug("redis cache miss/error for recommendations: %s", e)

    # get track URIs from whichever store backs this playlist
    try:
        item_refs = await _read_playlist_items(playlist, artist)
    except Exception as e:
        logger.warning("failed to fetch playlist record for recommendations: %s", e)
        return unavailable

    if not item_refs:
        return unavailable

    track_uris = [ref["uri"] for ref in item_refs]

    # resolve URIs to track IDs
    track_result = await db.execute(
        select(Track.id).where(Track.atproto_record_uri.in_(track_uris))
    )
    track_ids = list(track_result.scalars().all())

    if not track_ids:
        return unavailable

    # compute recommendations
    try:
        recs = await get_playlist_recommendations(track_ids, limit=limit)
    except Exception as e:
        logger.warning("recommendation computation failed: %s", e)
        return unavailable

    if not recs:
        return PlaylistRecommendationsResponse(tracks=[], available=True)

    # hydrate from DB
    rec_ids = [r.track_id for r in recs]
    stmt = (
        select(Track, Artist)
        .join(Artist, Track.artist_did == Artist.did)
        .where(Track.id.in_(rec_ids))
    )
    hydrate_result = await db.execute(stmt)
    hydrate_rows = hydrate_result.all()

    track_lookup: dict[int, tuple[Track, Artist]] = {}
    for track, rec_artist in hydrate_rows:
        track_lookup[track.id] = (track, rec_artist)

    # preserve recommendation order
    recommended_tracks: list[RecommendedTrack] = []
    for rec in recs:
        if rec.track_id not in track_lookup:
            continue
        track, rec_artist = track_lookup[rec.track_id]
        recommended_tracks.append(
            RecommendedTrack(
                id=track.id,
                title=track.title,
                artist_handle=rec_artist.handle,
                artist_display_name=rec_artist.display_name,
                image_url=track.image_url,
            )
        )

    response = PlaylistRecommendationsResponse(
        tracks=recommended_tracks,
        available=True,
    )

    # cache result
    try:
        redis = get_async_redis_client()
        await redis.set(
            cache_key,
            response.model_dump_json(),
            ex=86400,  # 24h TTL
        )
    except Exception as e:
        logger.debug("failed to cache recommendations: %s", e)

    return response
