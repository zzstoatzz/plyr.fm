"""background tasks for image moderation.

image moderation was previously awaited inline during track/album PATCH
requests, blocking the HTTP response for ~3-6s while the moderation
service ran claude vision. moving to a docket task makes the response
instantaneous while still flagging unsafe images.
"""

import logging

import httpx
import logfire
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.background import get_docket
from backend._internal.clients.moderation import get_moderation_client
from backend._internal.notifications import ImageOwner, notification_service
from backend.models import Album, Artist, Playlist, Track
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def find_image_owners(db: AsyncSession, image_id: str) -> list[ImageOwner]:
    """every album, playlist and track whose cover is `image_id`.

    image ids are content hashes, so the same bytes can back several rows.
    """
    albums = await db.execute(
        select(Album.title, Album.slug, Artist.handle)
        .join(Artist, Album.artist_did == Artist.did)
        .where(Album.image_id == image_id)
        .order_by(Album.created_at)
    )
    playlists = await db.execute(
        select(Playlist.id, Playlist.name, Playlist.is_private, Artist.handle)
        .join(Artist, Playlist.owner_did == Artist.did)
        .where(Playlist.image_id == image_id)
        .order_by(Playlist.created_at)
    )
    tracks = await db.execute(
        select(Track.id, Track.title, Artist.handle)
        .join(Artist, Track.artist_did == Artist.did)
        .where(Track.image_id == image_id)
        .order_by(Track.created_at)
    )
    return [
        *(
            ImageOwner("album", title, handle, f"u/{handle}/album/{slug}")
            for title, slug, handle in albums
        ),
        *(
            ImageOwner("playlist", name, handle, f"playlist/{id_}", is_private)
            for id_, name, is_private, handle in playlists
        ),
        *(
            ImageOwner("track", title, handle, f"track/{id_}")
            for id_, title, handle in tracks
        ),
    ]


async def scan_image_moderation(
    image_id: str,
    image_url: str,
    content_type: str,
    entity_type: str,
) -> None:
    """download the image from R2 and scan it for policy violations.

    called as a docket background task after the image has been stored.
    fetches the image bytes from its public URL (already on R2 CDN) and
    sends them to the moderation service. if the image is flagged, fires
    a notification — same behavior as the old inline path, just not
    blocking the user's request.
    """
    try:
        # fetch the image bytes from R2 (public URL, no auth needed)
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as http:
            response = await http.get(image_url)
            response.raise_for_status()
            image_bytes = response.content

        client = get_moderation_client()
        result = await client.scan_image(image_bytes, image_id, content_type)

        if not result.is_safe:
            async with db_session() as db:
                owners = await find_image_owners(db, image_id)
            await notification_service.send_image_flag_notification(
                image_id=image_id,
                severity=result.severity,
                categories=result.violated_categories,
                context=f"{entity_type} cover",
                owners=owners,
            )

        logfire.info(
            "background image moderation complete",
            image_id=image_id,
            is_safe=result.is_safe,
            severity=result.severity,
        )
    except Exception as e:
        logger.warning("background image moderation failed for %s: %s", image_id, e)


async def schedule_image_moderation_scan(
    *,
    image_id: str,
    image_url: str,
    content_type: str,
    entity_type: str,
) -> None:
    """schedule an image moderation scan via docket."""
    docket = get_docket()
    await docket.add(scan_image_moderation)(
        image_id, image_url, content_type, entity_type
    )
    logfire.info("scheduled image moderation scan", image_id=image_id)
