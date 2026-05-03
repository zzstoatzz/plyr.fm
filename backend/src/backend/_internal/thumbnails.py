"""thumbnail generation for track/album/playlist artwork."""

import logging
from io import BytesIO

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)


def generate_thumbnail(image_data: bytes, size: int = 96, quality: int = 80) -> bytes:
    """generate a square WebP thumbnail from image data.

    center-crops to square, resizes with LANCZOS, encodes as WebP.

    args:
        image_data: raw image bytes (any format Pillow supports)
        size: output dimension in pixels (square)
        quality: WebP compression quality (0-100)

    returns:
        WebP-encoded thumbnail bytes
    """
    img = Image.open(BytesIO(image_data))
    img = ImageOps.exif_transpose(img)

    # convert to RGB (handles RGBA, palette, etc.)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    # center-crop to square
    w, h = img.size
    if w != h:
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))

    # resize with high-quality resampling
    img = img.resize((size, size), Image.Resampling.LANCZOS)

    # encode as WebP
    buf = BytesIO()
    img.save(buf, format="WEBP", quality=quality)
    return buf.getvalue()


async def generate_and_save(
    image_data: bytes, image_id: str, context: str = "image"
) -> str | None:
    """generate thumbnail and save to storage. returns thumbnail URL or None on failure."""
    from backend.storage import storage

    try:
        thumb_data = generate_thumbnail(image_data)
        return await storage.save_thumbnail(thumb_data, image_id)
    except Exception as e:
        logger.warning("failed to generate %s thumbnail: %s", context, e)
        return None
