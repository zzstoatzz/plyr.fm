"""RSS feed generation for artist, album, and playlist collections."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from feedgen.feed import FeedGenerator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal.atproto.records.fm_plyr.track import get_record_public
from backend.config import settings
from backend.models import Artist, Track, get_db
from backend.models.album import Album
from backend.models.playlist import Playlist

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feeds", tags=["feeds"])


def _rss_response(fg: FeedGenerator) -> Response:
    """Render a FeedGenerator to an RSS XML response."""
    return Response(
        content=fg.rss_str(pretty=True),
        media_type="application/rss+xml; charset=utf-8",
    )


def _add_itunes_ns(fg: FeedGenerator) -> None:
    """Register the iTunes podcast namespace on the feed."""
    fg.load_extension("podcast")


def _set_feed_image(fg: FeedGenerator, url: str) -> None:
    """Set feed image, skipping URLs that feedgen rejects (must end in .png/.jpg)."""
    try:
        fg.image(url)
        fg.podcast.itunes_image(url)  # type: ignore[attr-defined]
    except ValueError:
        logger.debug("skipping feed image with unsupported URL: %s", url)


def _add_track_item(
    fg: FeedGenerator,
    track: Track,
    frontend_url: str,
) -> None:
    """Add a track as an RSS <item> entry."""
    entry = fg.add_entry()
    entry.title(track.title)
    entry.link(href=f"{frontend_url}/track/{track.id}")
    entry.guid(
        track.atproto_record_uri or str(track.id),
        permalink=False,
    )
    entry.pubDate(track.created_at)

    if track.description:
        entry.description(track.description)

    if track.r2_url:
        entry.enclosure(
            url=track.r2_url,
            type=_audio_mime_type(track.file_type),
            length="0",
        )

    if track.duration:
        entry.podcast.itunes_duration(track.duration)

    if track.image_url:
        entry.podcast.itunes_image(track.image_url)


def _audio_mime_type(file_type: str) -> str:
    """Map file extension to MIME type."""
    return {
        "mp3": "audio/mpeg",
        "wav": "audio/wav",
        "m4a": "audio/mp4",
        "flac": "audio/flac",
        "aiff": "audio/aiff",
        "aif": "audio/aiff",
        "ogg": "audio/ogg",
    }.get(file_type, "audio/mpeg")


@router.get("/artist/{handle}")
async def artist_feed(
    handle: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """RSS feed of all public tracks by an artist, newest first."""
    result = await db.execute(select(Artist).where(Artist.handle == handle))
    artist = result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=404, detail="artist not found")

    frontend_url = str(settings.frontend.url).rstrip("/")

    fg = FeedGenerator()
    _add_itunes_ns(fg)
    fg.title(f"{artist.display_name} on plyr.fm")
    fg.link(href=f"{frontend_url}/u/{handle}")
    fg.description(f"tracks by {artist.display_name}")
    fg.language("en")

    if artist.avatar_url:
        _set_feed_image(fg, artist.avatar_url)

    # self-link for feed readers
    fg.link(
        href=f"{frontend_url}/api/feeds/artist/{handle}",
        rel="self",
        type="application/rss+xml",
    )

    # fetch public (non-gated) tracks, newest first
    tracks_result = await db.execute(
        select(Track)
        .options(selectinload(Track.artist))
        .where(Track.artist_did == artist.did, Track.support_gate.is_(None))
        .order_by(Track.created_at.desc())
        .limit(200)
    )
    tracks = tracks_result.scalars().all()

    if tracks:
        fg.lastBuildDate(tracks[0].created_at)

    for track in tracks:
        _add_track_item(fg, track, frontend_url)

    return _rss_response(fg)


@router.get("/album/{handle}/{slug}")
async def album_feed(
    handle: str,
    slug: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """RSS feed of tracks in an album."""
    result = await db.execute(
        select(Album)
        .join(Artist)
        .options(selectinload(Album.artist))
        .where(Artist.handle == handle, Album.slug == slug)
    )
    album = result.scalar_one_or_none()
    if not album:
        raise HTTPException(status_code=404, detail="album not found")

    frontend_url = str(settings.frontend.url).rstrip("/")

    fg = FeedGenerator()
    _add_itunes_ns(fg)
    fg.title(f"{album.title} by {album.artist.display_name}")
    fg.link(href=f"{frontend_url}/u/{handle}/album/{slug}")
    fg.description(album.description or f"album by {album.artist.display_name}")
    fg.language("en")

    if image_url := album.image_url or album.artist.avatar_url:
        _set_feed_image(fg, image_url)

    fg.link(
        href=f"{frontend_url}/api/feeds/album/{handle}/{slug}",
        rel="self",
        type="application/rss+xml",
    )

    # fetch public (non-gated) tracks in album
    tracks_result = await db.execute(
        select(Track)
        .options(selectinload(Track.artist))
        .where(Track.album_id == album.id, Track.support_gate.is_(None))
        .order_by(Track.created_at.asc())
    )
    tracks = tracks_result.scalars().all()

    if tracks:
        fg.lastBuildDate(max(t.created_at for t in tracks))

    for track in tracks:
        _add_track_item(fg, track, frontend_url)

    return _rss_response(fg)


@router.get("/playlist/{playlist_id}")
async def playlist_feed(
    playlist_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """RSS feed of tracks in a playlist."""
    result = await db.execute(
        select(Playlist)
        .options(selectinload(Playlist.owner))
        .where(Playlist.id == playlist_id)
    )
    playlist = result.scalar_one_or_none()
    if not playlist:
        raise HTTPException(status_code=404, detail="playlist not found")

    frontend_url = str(settings.frontend.url).rstrip("/")

    fg = FeedGenerator()
    _add_itunes_ns(fg)
    fg.title(f"{playlist.name} by {playlist.owner.display_name}")
    fg.link(href=f"{frontend_url}/playlist/{playlist_id}")
    fg.description(f"playlist by {playlist.owner.display_name}")
    fg.language("en")

    if image_url := playlist.image_url or playlist.owner.avatar_url:
        _set_feed_image(fg, image_url)

    fg.link(
        href=f"{frontend_url}/api/feeds/playlist/{playlist_id}",
        rel="self",
        type="application/rss+xml",
    )

    # playlists reference tracks by ATProto URI in a list record.
    # for simplicity, fetch all tracks owned by the playlist owner that are
    # in the playlist's cached track_count. a full implementation would
    # resolve the ATProto list items, but the DB-cached tracks are sufficient.
    # Instead, query tracks that reference this playlist's list URI.
    # Since playlists don't have a direct FK, we resolve via the ATProto list.
    # For now, we rely on the list endpoint's approach — fetch list items from PDS.

    track_uris: list[str] = []
    try:
        list_data = await get_record_public(playlist.atproto_record_uri)
        items = list_data.get("value", {}).get("items", [])
        track_uris = [item.get("uri") for item in items if item.get("uri")]
    except Exception:
        logger.warning(
            "failed to fetch playlist list record for feed: %s",
            playlist.atproto_record_uri,
        )

    tracks: list[Track] = []
    if track_uris:
        tracks_result = await db.execute(
            select(Track)
            .options(selectinload(Track.artist))
            .where(
                Track.atproto_record_uri.in_(track_uris),
                Track.support_gate.is_(None),
            )
        )
        tracks_by_uri = {t.atproto_record_uri: t for t in tracks_result.scalars().all()}
        # maintain playlist order
        tracks = [tracks_by_uri[uri] for uri in track_uris if uri in tracks_by_uri]

    if tracks:
        fg.lastBuildDate(max(t.created_at for t in tracks))

    for track in tracks:
        _add_track_item(fg, track, frontend_url)

    return _rss_response(fg)
