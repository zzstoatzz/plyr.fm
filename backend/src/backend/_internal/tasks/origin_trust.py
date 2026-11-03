"""URL origin trust checks for Jetstream ingest.

validates that audioUrl and imageUrl values come from trusted origins
(currently the platform's R2 CDN). designed for future extension where
artists register their own storage origins (BYOS).
"""

from typing import Any
from urllib.parse import urlparse

import logfire
from atproto_oauth.security import is_safe_url

from backend._internal.atproto.client import pds_blob_url
from backend.config import settings
from backend.models import Artist


def _origin_of(url: str) -> str:
    """extract scheme://netloc from a URL."""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


async def is_trusted_audio_origin(url: str, *, artist_did: str) -> bool:
    """check if an audioUrl comes from a trusted origin.

    currently only trusts the platform's R2 CDN. designed for future
    extension where artists register their own storage origins.
    """
    if not url:
        return True
    origin = _origin_of(url)
    if cdn_url := settings.storage.r2_public_bucket_url:
        if origin == _origin_of(cdn_url):
            return True
    # future: check per-artist registered origins via artist_did
    return False


async def is_trusted_image_origin(url: str, *, artist_did: str) -> bool:
    """check if an imageUrl comes from a trusted origin.

    currently only trusts the platform's R2 image CDN. designed for future
    extension where artists register their own storage origins.
    """
    if not url:
        return True
    origin = _origin_of(url)
    if cdn_url := settings.storage.r2_public_image_bucket_url:
        if origin == _origin_of(cdn_url):
            return True
    # future: check per-artist registered origins via artist_did
    return False


def image_blob_url(record: dict[str, Any], artist: Artist | None) -> str | None:
    """the getBlob URL for a record's imageBlob on the artist's own PDS.

    imageBlob is cover art the client stored on the PDS, so the trusted URL is
    derived from the blob ref, never taken from the record.
    """
    blob = record.get("imageBlob")
    cid = blob.get("ref", {}).get("$link") if isinstance(blob, dict) else None
    if not isinstance(cid, str) or not cid:
        return None
    if not artist or not artist.pds_url or not is_safe_url(artist.pds_url):
        return None
    return pds_blob_url(artist.pds_url, artist.did, cid)


async def record_image_url(
    record: dict[str, Any], *, uri: str, did: str, artist: Artist | None
) -> str | None:
    """the cover URL to index for a track record, or None.

    an imageBlob on the artist's PDS wins; otherwise imageUrl, if its origin is
    trusted. untrusted imageUrls are dropped (the track itself stays valid).
    """
    if blob_url := image_blob_url(record, artist):
        return blob_url
    image_url = record.get("imageUrl")
    if not image_url:
        return None
    if await is_trusted_image_origin(image_url, artist_did=did):
        return image_url
    logfire.warn("ingest: stripping untrusted imageUrl", uri=uri, image_url=image_url)
    return None
