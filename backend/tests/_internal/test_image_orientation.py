"""regression tests for EXIF orientation normalization on uploads + thumbnails."""

from io import BytesIO

from PIL import Image

from backend._internal.image import has_exif_rotation, normalize_orientation
from backend._internal.thumbnails import generate_thumbnail


def _jpeg_with_orientation(orientation: int) -> bytes:
    """build a 200x100 landscape JPEG with the given EXIF Orientation tag."""
    img = Image.new("RGB", (200, 100), color="red")
    exif = img.getexif()
    exif[0x0112] = orientation
    buf = BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def _plain_jpeg() -> bytes:
    img = Image.new("RGB", (200, 100), color="blue")
    buf = BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_has_exif_rotation_detects_non_identity_orientation() -> None:
    assert has_exif_rotation(_jpeg_with_orientation(6)) is True
    assert has_exif_rotation(_jpeg_with_orientation(8)) is True
    assert has_exif_rotation(_jpeg_with_orientation(3)) is True


def test_has_exif_rotation_ignores_identity_and_missing() -> None:
    assert has_exif_rotation(_jpeg_with_orientation(1)) is False
    assert has_exif_rotation(_plain_jpeg()) is False


def test_normalize_orientation_rotates_landscape_to_portrait_for_orientation_6() -> (
    None
):
    """orientation=6 means rotate 90° CW → 200x100 sensor becomes 100x200 upright."""
    rotated = normalize_orientation(_jpeg_with_orientation(6))
    img = Image.open(BytesIO(rotated))
    assert img.size == (100, 200)
    # the new image should have no rotation tag (or identity)
    assert img.getexif().get(0x0112, 1) in (0, 1)


def test_normalize_orientation_returns_unchanged_when_no_rotation() -> None:
    original = _plain_jpeg()
    assert normalize_orientation(original) is original


def test_normalize_orientation_returns_unchanged_when_orientation_is_identity() -> None:
    original = _jpeg_with_orientation(1)
    assert normalize_orientation(original) is original


def test_normalize_orientation_handles_mpo_format_as_jpeg(monkeypatch) -> None:
    """iPhone photos open as MPO (Multi-Picture Object); save them back as JPEG.

    if MPO isn't in the format map, normalize is a silent no-op — that's
    how the album cover from track 923 ('day and age') escaped #1364's
    fix on first pass.
    """
    src = _jpeg_with_orientation(6)
    real_open = Image.open

    def fake_open(fp, *args, **kwargs):
        img = real_open(fp, *args, **kwargs)
        img.format = "MPO"  # force the iPhone format
        return img

    monkeypatch.setattr("backend._internal.image.Image.open", fake_open, raising=True)

    out_bytes = normalize_orientation(src)

    # undo the patch BEFORE re-opening so we read the real format
    monkeypatch.undo()
    assert out_bytes != src, "MPO should be re-encoded with rotation applied"
    out = Image.open(BytesIO(out_bytes))
    assert out.format == "JPEG"
    assert out.size == (100, 200)


def test_generate_thumbnail_applies_exif_rotation() -> None:
    """sideways-tagged JPEG should produce an upright (square) thumbnail."""
    sideways = _jpeg_with_orientation(6)
    thumb = generate_thumbnail(sideways, size=64)
    img = Image.open(BytesIO(thumb))
    assert img.size == (64, 64)
    # no good way to assert color from a single-color test image post-crop,
    # but at minimum we can verify it didn't crash and is a valid square WebP
    assert img.format == "WEBP"
