"""URL origin trust checks for Jetstream ingest.

validates that audioUrl and imageUrl values come from trusted origins
(currently the platform's R2 CDN). designed for future extension where
artists register their own storage origins (BYOS).
"""

from urllib.parse import urlparse

from backend.config import settings


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
