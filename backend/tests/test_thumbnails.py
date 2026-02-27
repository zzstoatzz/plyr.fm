"""tests for thumbnail generation."""

from io import BytesIO

from PIL import Image

from backend._internal.thumbnails import generate_thumbnail


def _make_png(width: int, height: int, mode: str = "RGB") -> bytes:
    """create a minimal PNG image in memory."""
    img = Image.new(mode, (width, height), color="red")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_generate_thumbnail_square_input():
    """square input produces 96x96 WebP output."""
    png_data = _make_png(500, 500)
    result = generate_thumbnail(png_data)

    img = Image.open(BytesIO(result))
    assert img.size == (96, 96)
    assert img.format == "WEBP"


def test_generate_thumbnail_landscape_input():
    """landscape input is center-cropped then resized to 96x96."""
    png_data = _make_png(800, 400)
    result = generate_thumbnail(png_data)

    img = Image.open(BytesIO(result))
    assert img.size == (96, 96)
    assert img.format == "WEBP"


def test_generate_thumbnail_portrait_input():
    """portrait input is center-cropped then resized to 96x96."""
    png_data = _make_png(400, 800)
    result = generate_thumbnail(png_data)

    img = Image.open(BytesIO(result))
    assert img.size == (96, 96)
    assert img.format == "WEBP"


def test_generate_thumbnail_rgba_input():
    """RGBA input is converted to RGB before encoding."""
    png_data = _make_png(200, 200, mode="RGBA")
    result = generate_thumbnail(png_data)

    img = Image.open(BytesIO(result))
    assert img.size == (96, 96)
    assert img.format == "WEBP"


def test_generate_thumbnail_custom_size():
    """custom size parameter produces that size."""
    png_data = _make_png(500, 500)
    result = generate_thumbnail(png_data, size=48)

    img = Image.open(BytesIO(result))
    assert img.size == (48, 48)


def test_generate_thumbnail_small_input():
    """input smaller than target size is still resized (upscaled)."""
    png_data = _make_png(32, 32)
    result = generate_thumbnail(png_data)

    img = Image.open(BytesIO(result))
    assert img.size == (96, 96)


def test_generate_thumbnail_returns_bytes():
    """result is valid bytes that can be uploaded."""
    png_data = _make_png(100, 100)
    result = generate_thumbnail(png_data)

    assert isinstance(result, bytes)
    assert len(result) > 0
    # WebP magic bytes
    assert result[:4] == b"RIFF"
