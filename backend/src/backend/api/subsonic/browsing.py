"""subsonic library-browsing endpoints: albums, artists, genres, capability stubs.

clients build their library views from these. albums and artists map onto the
existing models; albums with no visible tracks are hidden (matching the main
albums API, where empty albums are unfinalized drafts).
"""

from typing import Any

from fastapi import Request, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session
from backend._internal.content_labels import filter_sensitive_audio_tracks_for_viewer
from backend._internal.track_visibility import track_visible_filter
from backend.api.subsonic.endpoints import Params, _require, _rest, _run, _song
from backend.api.subsonic.responses import ERROR_NOT_FOUND, SubsonicError
from backend.models import Album, Artist, Track
from backend.utilities.database import db_session

_MAX_LIST_SIZE = 500


def _int_param(params: Params, name: str, default: int) -> int:
    try:
        return max(0, int(params.get(name, default)))
    except ValueError:
        return default


def _album_entry(
    album: Album, artist: Artist, song_count: int, duration: int
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "id": album.id,
        "name": album.title,
        "title": album.title,
        "album": album.title,
        "isDir": True,
        "artist": artist.display_name or artist.handle,
        "artistId": artist.did,
        "songCount": song_count,
        "duration": duration,
        "created": album.created_at.isoformat(),
    }
    if album.image_url or album.thumbnail_url:
        entry["coverArt"] = f"al-{album.id}"
    return entry


async def _album_rows(
    db: AsyncSession,
    session_did: str | None,
    order_by: Any,
    size: int,
    offset: int,
) -> list[tuple[Album, Artist, int]]:
    """albums (with owning artist + visible-track count), hiding empty albums."""
    result = await db.execute(
        select(Album, Artist, func.count(Track.id))
        .join(Artist, Album.artist_did == Artist.did)
        .join(Track, Track.album_id == Album.id)
        .where(track_visible_filter(session_did))
        .group_by(Album.id, Artist.did)
        .order_by(order_by)
        .limit(size)
        .offset(offset)
    )
    return [(album, artist, count) for album, artist, count in result.all()]


async def _album_list_payload(session: Session, params: Params) -> list[dict[str, Any]]:
    list_type = params.get("type", "alphabeticalByName")
    size = min(_int_param(params, "size", 10), _MAX_LIST_SIZE)
    offset = _int_param(params, "offset", 0)
    if list_type in ("newest", "recent"):
        order_by = Album.created_at.desc()
    elif list_type == "random":
        order_by = func.random()
    elif list_type in ("frequent", "highest"):
        order_by = func.sum(Track.play_count).desc()
    else:
        order_by = func.lower(Album.title)
    async with db_session() as db:
        rows = await _album_rows(db, session.did, order_by, size, offset)
    return [_album_entry(album, artist, count, 0) for album, artist, count in rows]


@_rest("getAlbumList")
async def get_album_list(request: Request) -> Response:
    async def impl(session: Session, params: Params) -> dict[str, Any]:
        return {"albumList": {"album": await _album_list_payload(session, params)}}

    return await _run(request, impl)


@_rest("getAlbumList2")
async def get_album_list2(request: Request) -> Response:
    async def impl(session: Session, params: Params) -> dict[str, Any]:
        return {"albumList2": {"album": await _album_list_payload(session, params)}}

    return await _run(request, impl)


@_rest("getAlbum")
async def get_album(request: Request) -> Response:
    async def impl(session: Session, params: Params) -> dict[str, Any]:
        album_id = _require(params, "id")
        async with db_session() as db:
            result = await db.execute(
                select(Album, Artist)
                .join(Artist, Album.artist_did == Artist.did)
                .where(Album.id == album_id)
            )
            row = result.first()
            if not row:
                raise SubsonicError(ERROR_NOT_FOUND, "album not found")
            album, artist = row
            track_result = await db.execute(
                select(Track)
                .options(selectinload(Track.artist))
                .where(Track.album_id == album.id)
                .where(track_visible_filter(session.did))
                .order_by(Track.created_at)
            )
            tracks, _ = await filter_sensitive_audio_tracks_for_viewer(
                db, track_result.scalars().all(), None
            )
        songs = [_song(track) for track in tracks]
        return {
            "album": {
                **_album_entry(
                    album,
                    artist,
                    len(songs),
                    sum(track.duration or 0 for track in tracks),
                ),
                "song": songs,
            }
        }

    return await _run(request, impl)


@_rest("getArtists")
async def get_artists(request: Request) -> Response:
    async def impl(session: Session, _: Params) -> dict[str, Any]:
        async with db_session() as db:
            result = await db.execute(
                select(
                    Artist, func.count(func.distinct(Track.album_id)).label("albums")
                )
                .join(Track, Track.artist_did == Artist.did)
                .where(track_visible_filter(session.did))
                .group_by(Artist.did)
                .order_by(func.lower(Artist.display_name))
            )
            rows = result.all()
        indexes: dict[str, list[dict[str, Any]]] = {}
        for artist, album_count in rows:
            name = artist.display_name or artist.handle
            letter = name[0].upper() if name and name[0].isalpha() else "#"
            indexes.setdefault(letter, []).append(
                {"id": artist.did, "name": name, "albumCount": album_count}
            )
        return {
            "artists": {
                "ignoredArticles": "",
                "index": [
                    {"name": letter, "artist": artists}
                    for letter, artists in indexes.items()
                ],
            }
        }

    return await _run(request, impl)


@_rest("getArtist")
async def get_artist(request: Request) -> Response:
    async def impl(session: Session, params: Params) -> dict[str, Any]:
        artist_did = _require(params, "id")
        async with db_session() as db:
            artist = await db.scalar(select(Artist).where(Artist.did == artist_did))
            if not artist:
                raise SubsonicError(ERROR_NOT_FOUND, "artist not found")
            rows = await _album_rows(
                db,
                session.did,
                func.lower(Album.title),
                _MAX_LIST_SIZE,
                0,
            )
        albums = [
            _album_entry(album, album_artist, count, 0)
            for album, album_artist, count in rows
            if album.artist_did == artist_did
        ]
        return {
            "artist": {
                "id": artist.did,
                "name": artist.display_name or artist.handle,
                "albumCount": len(albums),
                "album": albums,
            }
        }

    return await _run(request, impl)


@_rest("getRandomSongs")
async def get_random_songs(request: Request) -> Response:
    async def impl(session: Session, params: Params) -> dict[str, Any]:
        size = min(_int_param(params, "size", 10), _MAX_LIST_SIZE)
        async with db_session() as db:
            result = await db.execute(
                select(Track)
                .options(selectinload(Track.artist))
                .where(track_visible_filter(session.did))
                .order_by(func.random())
                .limit(size)
            )
            tracks, _ = await filter_sensitive_audio_tracks_for_viewer(
                db, result.scalars().all(), None
            )
        return {"randomSongs": {"song": [_song(track) for track in tracks]}}

    return await _run(request, impl)


@_rest("getGenres")
async def get_genres(request: Request) -> Response:
    async def impl(_: Session, __: Params) -> dict[str, Any]:
        return {"genres": {"genre": []}}

    return await _run(request, impl)


@_rest("getOpenSubsonicExtensions")
async def get_open_subsonic_extensions(request: Request) -> Response:
    async def impl(_: Session, __: Params) -> dict[str, Any]:
        return {"openSubsonicExtensions": []}

    return await _run(request, impl)
