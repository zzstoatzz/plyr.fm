"""cached member-track artwork previews for composite playlist covers.

`Playlist.preview_thumbnails` holds up to 4 distinct member-track artwork
URLs in playlist order. clients render a composite cover from them when
the playlist has no explicit image. refreshed on item mutations and
self-healed on detail reads.

the cache stores each track's *full-size* artwork URL — clients request
display-sized renditions at the CDN edge, so a big hero mosaic and a tiny
menu tile both come from the same cached URL. (older rows cached the 96px
thumbnail; the detail-read heal rewrites them.)
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Playlist, Track
from backend.schemas import TrackResponse

PREVIEW_THUMBNAIL_LIMIT = 4
"""max member-track artwork URLs cached per playlist."""


async def compute_preview_thumbnails(
    db: AsyncSession, item_uris: list[str]
) -> list[str]:
    """first N distinct member-track artwork URLs, in playlist order.

    tracks without artwork are skipped; duplicates (e.g. an album's tracks
    sharing one cover) collapse so the composite shows distinct art.
    """
    if not item_uris:
        return []
    result = await db.execute(
        select(Track.atproto_record_uri, Track.thumbnail_url, Track.image_url).where(
            Track.atproto_record_uri.in_(item_uris)
        )
    )
    art_by_uri = {uri: image or thumbnail for uri, thumbnail, image in result.all()}
    previews: list[str] = []
    for uri in item_uris:
        if (art := art_by_uri.get(uri)) and art not in previews:
            previews.append(art)
            if len(previews) == PREVIEW_THUMBNAIL_LIMIT:
                break
    return previews


def previews_from_tracks(tracks: list[TrackResponse]) -> list[str]:
    """same projection as `compute_preview_thumbnails`, from hydrated tracks."""
    previews: list[str] = []
    for track in tracks:
        if (art := track.image_url or track.thumbnail_url) and art not in previews:
            previews.append(art)
            if len(previews) == PREVIEW_THUMBNAIL_LIMIT:
                break
    return previews


async def heal_preview_thumbnails(
    db: AsyncSession, playlist: Playlist, tracks: list[TrackResponse]
) -> None:
    """refresh the cached previews when they've drifted from actual items.

    detail reads already hydrate the full track list, so this catches edits
    made by other atproto clients directly against the PDS list record.
    """
    if (previews := previews_from_tracks(tracks)) != (
        playlist.preview_thumbnails or []
    ):
        playlist.preview_thumbnails = previews
        await db.commit()
