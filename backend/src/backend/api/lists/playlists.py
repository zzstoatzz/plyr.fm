"""playlist CRUD endpoints.

playlists come in two flavors:

* **public** — cached metadata for an ATProto list record on the user's PDS.
  ``atproto_record_uri`` is the source of truth for items.

* **private** — lives in a permissioned space (single-member, owner-only)
  modeled after atproto's permissioned-data spec. ``space_uri`` is set;
  the items live inline in a ``SpaceRecord`` keyed by playlist id.
  no ATProto list record is written.

see ``backend._internal.spaces`` for the abstraction and
zzstoatzz/plyr.fm#1384 for the strategy.
"""

import contextlib
import json
import logging
from datetime import UTC, datetime
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
from backend._internal.spaces import (
    PLAYLIST_COLLECTION,
    can_read,
    create_record,
    delete_record,
    get_or_create_personal_space,
    get_record,
)
from backend._internal.spaces import update_record as update_space_record
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

# skey for a user's personal "playlists" space — distinguishes from future
# personal spaces ("drafts", "history") under the same fm.plyr.personal type
_PLAYLISTS_SKEY = "playlists"


def _build_playlist_response(playlist: Playlist, owner_handle: str) -> PlaylistResponse:
    """common projection from Playlist row → API response."""
    return PlaylistResponse(
        id=playlist.id,
        name=playlist.name,
        owner_did=playlist.owner_did,
        owner_handle=owner_handle,
        track_count=playlist.track_count,
        image_url=playlist.image_url,
        show_on_profile=playlist.show_on_profile,
        atproto_record_uri=playlist.atproto_record_uri,
        is_private=playlist.space_uri is not None,
        created_at=playlist.created_at.isoformat(),
    )


async def _read_playlist_items(
    db: AsyncSession,
    playlist: Playlist,
    artist: Artist,
) -> list[dict[str, str]]:
    """fetch playlist items as ``[{uri, cid}, ...]``.

    private → SpaceRecord; public → ATProto list record on the owner's PDS.
    """
    if playlist.space_uri is not None:
        record = await get_record(
            db, playlist.space_uri, PLAYLIST_COLLECTION, playlist.id
        )
        if record is None:
            return []
        items = record.value.get("items", [])
        return [
            {"uri": item["uri"], "cid": item.get("cid", "")}
            for item in items
            if item.get("uri")
        ]

    if not playlist.atproto_record_uri:
        return []
    uris = await fetch_list_item_uris(playlist.atproto_record_uri, artist.pds_url)
    return [{"uri": uri, "cid": ""} for uri in uris]


async def _write_private_playlist_items(
    db: AsyncSession,
    playlist: Playlist,
    items: list[dict[str, str]],
) -> None:
    """persist updated items for a private playlist into its SpaceRecord."""
    assert playlist.space_uri is not None
    record = await get_record(db, playlist.space_uri, PLAYLIST_COLLECTION, playlist.id)
    if record is None:
        # shouldn't happen — record is created at playlist creation time
        raise HTTPException(status_code=500, detail="private playlist record missing")
    new_value = dict(record.value)
    new_value["items"] = items
    new_value["updatedAt"] = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    await update_space_record(
        db, playlist.space_uri, PLAYLIST_COLLECTION, playlist.id, new_value
    )


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

    private: skips the ATProto write, scopes the playlist to the user's
    personal space, and stores items inline in a ``SpaceRecord``.
    """
    # get owner handle for response
    artist_result = await db.execute(select(Artist).where(Artist.did == session.did))
    artist = artist_result.scalar_one_or_none()
    owner_handle = artist.handle if artist else session.handle

    if body.is_private:
        # personal space (single-member, owner-only). created on first use.
        space = await get_or_create_personal_space(db, session.did, _PLAYLISTS_SKEY)
        playlist = Playlist(
            owner_did=session.did,
            name=body.name,
            atproto_record_uri=None,
            atproto_record_cid=None,
            space_uri=space.uri,
            track_count=0,
        )
        db.add(playlist)
        await db.flush()

        now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        await create_record(
            db,
            space_uri=space.uri,
            writer_did=session.did,
            collection=PLAYLIST_COLLECTION,
            rkey=playlist.id,
            value={
                "$type": PLAYLIST_COLLECTION,
                "name": body.name,
                "items": [],
                "createdAt": now,
                "updatedAt": now,
            },
        )
    else:
        # public: write ATProto list record first, then cache locally
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
            track_count=0,
        )
        db.add(playlist)
        await db.flush()

    db.add(
        CollectionEvent(
            event_type=(
                "playlist_create_private" if body.is_private else "playlist_create"
            ),
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

    private playlists are excluded regardless of ``show_on_profile``.
    """
    result = await db.execute(
        select(Playlist, Artist)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.owner_did == artist_did)
        .where(Playlist.show_on_profile == True)  # noqa: E712
        .where(Playlist.space_uri.is_(None))
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
    """get a playlist by its ATProto record URI (public only, auth optional for liked state).

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
        item_refs = await _read_playlist_items(db, playlist, artist)
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

    return PlaylistWithTracksResponse(
        **_build_playlist_response(playlist, artist.handle).model_dump(),
        tracks=tracks,
    )


@router.get("/playlists/{playlist_id}/meta", response_model=PlaylistResponse)
async def get_playlist_meta(
    playlist_id: str,
    db: AsyncSession = Depends(get_db),
    session: AuthSession | None = Depends(get_optional_session),
) -> PlaylistResponse:
    """get playlist metadata. used for link previews.

    public playlists are visible to anyone; private playlists require the
    viewer to be a member of the owning space (owner only in v0).
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

    if playlist.space_uri is not None and not await can_read(
        db, session.did if session else None, playlist.space_uri
    ):
        # don't leak existence of private playlists to non-members
        raise HTTPException(status_code=404, detail="playlist not found")

    return _build_playlist_response(playlist, artist.handle)


@router.get("/playlists/{playlist_id}", response_model=PlaylistWithTracksResponse)
async def get_playlist(
    playlist_id: str,
    db: AsyncSession = Depends(get_db),
    session: AuthSession | None = Depends(get_optional_session),
) -> PlaylistWithTracksResponse:
    """get a playlist with full track details.

    public playlists are visible to anyone; private playlists require the
    viewer to be a member of the owning space (owner only in v0).
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

    if playlist.space_uri is not None and not await can_read(
        db, session.did if session else None, playlist.space_uri
    ):
        raise HTTPException(status_code=404, detail="playlist not found")

    try:
        item_refs = await _read_playlist_items(db, playlist, artist)
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

    return PlaylistWithTracksResponse(
        **_build_playlist_response(playlist, artist.handle).model_dump(),
        tracks=tracks,
    )


@router.post("/playlists/{playlist_id}/tracks", response_model=PlaylistResponse)
async def add_track_to_playlist(
    playlist_id: str,
    body: AddTrackRequest,
    session: AuthSession = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> PlaylistResponse:
    """append a track to a playlist.

    public: rewrites the ATProto list record on the user's PDS.
    private: rewrites the inline ``items`` array on the SpaceRecord.
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

    if playlist.owner_did != session.did:
        raise HTTPException(status_code=403, detail="not playlist owner")

    if playlist.space_uri is not None:
        # private path
        record = await get_record(
            db, playlist.space_uri, PLAYLIST_COLLECTION, playlist.id
        )
        current_items = record.value.get("items", []) if record else []
        if any(item.get("uri") == body.track_uri for item in current_items):
            raise HTTPException(status_code=400, detail="track already in playlist")
        new_items = [
            *current_items,
            {"uri": body.track_uri, "cid": body.track_cid},
        ]
        await _write_private_playlist_items(db, playlist, new_items)
        playlist.track_count = len(new_items)
    else:
        # public path: round-trip through the user's PDS
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

    if playlist.owner_did != session.did:
        raise HTTPException(status_code=403, detail="not playlist owner")

    if playlist.space_uri is not None:
        # private path
        record = await get_record(
            db, playlist.space_uri, PLAYLIST_COLLECTION, playlist.id
        )
        current_items = record.value.get("items", []) if record else []
        new_items = [item for item in current_items if item.get("uri") != track_uri]
        if len(new_items) == len(current_items):
            raise HTTPException(status_code=404, detail="track not in playlist")
        await _write_private_playlist_items(db, playlist, new_items)
        playlist.track_count = len(new_items)
    else:
        # public path
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

    routes to either the ATProto list record (public) or the SpaceRecord
    (private). owner-only.
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

    if playlist.owner_did != session.did:
        raise HTTPException(status_code=403, detail="not playlist owner")

    if playlist.space_uri is not None:
        # private: rewrite the SpaceRecord's items array directly
        new_items = [
            {"uri": item["uri"], "cid": item.get("cid", "")}
            for item in body.items
            if item.get("uri")
        ]
        await _write_private_playlist_items(db, playlist, new_items)
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

    public: removes the ATProto list record and the local cache.
    private: removes the SpaceRecord and the local cache. the personal
    space itself is left in place (it's reused across playlists).
    """
    result = await db.execute(select(Playlist).where(Playlist.id == playlist_id))
    playlist = result.scalar_one_or_none()

    if not playlist:
        raise HTTPException(status_code=404, detail="playlist not found")

    if playlist.owner_did != session.did:
        raise HTTPException(status_code=403, detail="not playlist owner")

    if playlist.space_uri is not None:
        await delete_record(db, playlist.space_uri, PLAYLIST_COLLECTION, playlist.id)
    elif playlist.atproto_record_uri:
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

    if playlist.owner_did != session.did:
        raise HTTPException(
            status_code=403,
            detail="you can only upload cover art for your own playlists",
        )

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

    # show_on_profile is meaningless for private playlists but harmless to set
    if show_on_profile is not None:
        playlist.show_on_profile = show_on_profile

    if name is not None and name.strip():
        playlist.name = name.strip()

        if playlist.space_uri is not None:
            # private: update name on the SpaceRecord
            record = await get_record(
                db, playlist.space_uri, PLAYLIST_COLLECTION, playlist.id
            )
            if record is not None:
                new_value = dict(record.value)
                new_value["name"] = playlist.name
                new_value["updatedAt"] = (
                    datetime.now(UTC).isoformat().replace("+00:00", "Z")
                )
                await update_space_record(
                    db,
                    playlist.space_uri,
                    PLAYLIST_COLLECTION,
                    playlist.id,
                    new_value,
                )
        else:
            # public: also update the ATProto record with the new name
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

    if playlist.owner_did != session.did:
        raise HTTPException(status_code=403, detail="not playlist owner")

    if playlist.track_count == 0:
        return unavailable

    # cache key derived from CID for public, updated_at for private (no CID)
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
        item_refs = await _read_playlist_items(db, playlist, artist)
    except Exception as e:
        logger.warning("failed to fetch playlist record for recommendations: %s", e)
        return unavailable

    if not item_refs:
        return unavailable

    track_uris = [ref["uri"] for ref in item_refs]

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
