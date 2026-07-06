"""minimal subsonic endpoint surface: ping, license, playlists, stream, cover art.

every endpoint is registered at both `/<name>` and `/<name>.view` for GET and
POST (the spec allows either; libsonic POSTs a form body by default). streaming
and cover art 307-redirect into the existing `/audio/{file_id}` and image CDN
surfaces rather than re-serving bytes.
"""

from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from fastapi import Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session
from backend._internal.track_visibility import track_visible_filter
from backend.api.lists.playlists import _can_view, _read_playlist_items
from backend.api.subsonic.auth import authenticate
from backend.api.subsonic.responses import (
    ERROR_GENERIC,
    ERROR_MISSING_PARAMETER,
    ERROR_NOT_AUTHORIZED,
    ERROR_NOT_FOUND,
    SubsonicError,
    error_response,
    subsonic_response,
)
from backend.api.subsonic.router import router
from backend.models import Artist, Playlist, Track
from backend.utilities.database import db_session

_AUDIO_CONTENT_TYPES = {
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "opus": "audio/opus",
    "aiff": "audio/aiff",
}

Handler = Callable[[Request], Awaitable[Response]]
Params = Mapping[str, str]


def _rest(path: str) -> Callable[[Handler], Handler]:
    """register a handler at /rest/<path> and /rest/<path>.view for GET+POST."""

    def wrap(handler: Handler) -> Handler:
        for route_path in (f"/{path}.view", f"/{path}"):
            router.api_route(route_path, methods=["GET", "POST"])(handler)
        return handler

    return wrap


async def _request_params(request: Request) -> Params:
    """merge query params with a POSTed form body (spec allows either)."""
    merged: dict[str, str] = dict(request.query_params)
    if request.method == "POST":
        form = await request.form()
        merged.update({k: v for k, v in form.items() if isinstance(v, str)})
    return merged


async def _run(
    request: Request,
    impl: Callable[[Session, Params], Awaitable[dict[str, Any] | Response]],
) -> Response:
    params = await _request_params(request)
    try:
        session = await authenticate(params)
        result = await impl(session, params)
    except SubsonicError as error:
        return error_response(params, error)
    if isinstance(result, Response):
        return result
    return subsonic_response(params, result)


def _require(params: Params, name: str) -> str:
    if value := params.get(name):
        return value
    raise SubsonicError(
        ERROR_MISSING_PARAMETER, f"required parameter is missing: {name}"
    )


def _song(track: Track) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": str(track.id),
        "isDir": False,
        "type": "music",
        "title": track.title,
        "artist": track.artist.display_name or track.artist.handle,
        "album": track.album,
        "duration": track.duration,
        "playCount": track.play_count,
        "suffix": track.file_type,
        "contentType": _AUDIO_CONTENT_TYPES.get(track.file_type),
        "created": track.created_at.isoformat(),
    }
    if track.image_url or track.thumbnail_url:
        entry["coverArt"] = str(track.id)
    return entry


def _playlist(playlist: Playlist, owner_handle: str) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": playlist.id,
        "name": playlist.name,
        "owner": owner_handle,
        "public": not playlist.is_private,
        "songCount": playlist.track_count,
        "duration": 0,
        "created": playlist.created_at.isoformat(),
    }
    if playlist.image_url or playlist.thumbnail_url:
        entry["coverArt"] = f"pl-{playlist.id}"
    return entry


async def _tracks_by_uris(
    db: AsyncSession, uris: list[str], session_did: str | None
) -> list[Track]:
    """load visible tracks by AT-URI, preserving list order."""
    if not uris:
        return []
    result = await db.execute(
        select(Track)
        .options(selectinload(Track.artist))
        .where(Track.atproto_record_uri.in_(uris))
        .where(track_visible_filter(session_did))
    )
    by_uri = {t.atproto_record_uri: t for t in result.scalars().all()}
    return [by_uri[uri] for uri in uris if uri in by_uri]


async def _track_by_id(params: Params, session_did: str | None) -> Track:
    raw_id = _require(params, "id")
    try:
        track_id = int(raw_id)
    except ValueError:
        raise SubsonicError(ERROR_NOT_FOUND, "song not found") from None
    async with db_session() as db:
        result = await db.execute(
            select(Track)
            .options(selectinload(Track.artist))
            .where(Track.id == track_id)
            .where(track_visible_filter(session_did))
        )
        if track := result.scalar_one_or_none():
            return track
    raise SubsonicError(ERROR_NOT_FOUND, "song not found")


@_rest("ping")
async def ping(request: Request) -> Response:
    async def impl(_: Session, __: Params) -> dict[str, Any]:
        return {}

    return await _run(request, impl)


@_rest("getLicense")
async def get_license(request: Request) -> Response:
    async def impl(_: Session, __: Params) -> dict[str, Any]:
        return {"license": {"valid": True}}

    return await _run(request, impl)


@_rest("getMusicFolders")
async def get_music_folders(request: Request) -> Response:
    async def impl(_: Session, __: Params) -> dict[str, Any]:
        return {"musicFolders": {"musicFolder": [{"id": "1", "name": "plyr.fm"}]}}

    return await _run(request, impl)


@_rest("getPlaylists")
async def get_playlists(request: Request) -> Response:
    async def impl(session: Session, _: Params) -> dict[str, Any]:
        async with db_session() as db:
            result = await db.execute(
                select(Playlist, Artist)
                .join(Artist, Playlist.owner_did == Artist.did)
                .where(Playlist.owner_did == session.did)
                .order_by(Playlist.created_at.desc())
            )
            rows = result.all()
        return {
            "playlists": {
                "playlist": [
                    _playlist(playlist, artist.handle) for playlist, artist in rows
                ]
            }
        }

    return await _run(request, impl)


@_rest("getPlaylist")
async def get_playlist(request: Request) -> Response:
    async def impl(session: Session, params: Params) -> dict[str, Any]:
        playlist_id = _require(params, "id")
        async with db_session() as db:
            result = await db.execute(
                select(Playlist, Artist)
                .join(Artist, Playlist.owner_did == Artist.did)
                .where(Playlist.id == playlist_id)
            )
            row = result.first()
            if not row or not _can_view(session.did, row[0]):
                raise SubsonicError(ERROR_NOT_FOUND, "playlist not found")
            playlist, artist = row
            try:
                item_refs = await _read_playlist_items(playlist, artist)
            except Exception as exc:
                raise SubsonicError(
                    ERROR_GENERIC, f"failed to read playlist items: {exc}"
                ) from exc
            tracks = await _tracks_by_uris(
                db, [ref["uri"] for ref in item_refs], session.did
            )
        songs = [_song(track) for track in tracks]
        return {
            "playlist": {
                **_playlist(playlist, artist.handle),
                "songCount": len(songs),
                "duration": sum(track.duration or 0 for track in tracks),
                "entry": songs,
            }
        }

    return await _run(request, impl)


@_rest("getSong")
async def get_song(request: Request) -> Response:
    async def impl(session: Session, params: Params) -> dict[str, Any]:
        track = await _track_by_id(params, session.did)
        return {"song": _song(track)}

    return await _run(request, impl)


@_rest("download")
@_rest("stream")
async def stream(request: Request) -> Response:
    async def impl(session: Session, params: Params) -> Response:
        track = await _track_by_id(params, session.did)
        # gated and private tracks resolve their audio through cookie-bound
        # session checks that a redirected subsonic client can't satisfy
        if track.is_private or track.support_gate is not None:
            raise SubsonicError(
                ERROR_NOT_AUTHORIZED, "not authorized to stream this track"
            )
        # 302 (not the default 307): clients may POST, and a method-preserving
        # redirect of a POST is refused by urllib-family HTTP stacks
        return RedirectResponse(url=f"/audio/{track.file_id}", status_code=302)

    return await _run(request, impl)


@_rest("getCoverArt")
async def get_cover_art(request: Request) -> Response:
    async def impl(session: Session, params: Params) -> Response:
        art_id = _require(params, "id")
        if art_id.startswith("pl-"):
            async with db_session() as db:
                result = await db.execute(
                    select(Playlist).where(Playlist.id == art_id.removeprefix("pl-"))
                )
                playlist = result.scalar_one_or_none()
            if not playlist or not _can_view(session.did, playlist):
                raise SubsonicError(ERROR_NOT_FOUND, "cover art not found")
            url = playlist.image_url or playlist.thumbnail_url
        else:
            track = await _track_by_id(params, session.did)
            url = track.image_url or track.thumbnail_url
        if not url:
            raise SubsonicError(ERROR_NOT_FOUND, "cover art not found")
        return RedirectResponse(url=url, status_code=302)

    return await _run(request, impl)
