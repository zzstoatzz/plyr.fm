import io

from PIL import Image

from plyr_osprey.image_scan import SEND_BYTES, SEND_EDGE, sendable


def encoded(size: tuple[int, int], kind: str, mode: str = 'RGB') -> bytes:
    out = io.BytesIO()
    Image.effect_noise(size, 80).convert(mode).save(out, kind)
    return out.getvalue()


def test_a_cover_the_check_takes_is_sent_as_it_is() -> None:
    body = encoded((640, 640), 'PNG')
    assert sendable(body, 'image/png') == (body, 'image/png')


def test_a_big_cover_is_brought_down_to_what_the_check_takes() -> None:
    body = encoded((3000, 2000), 'PNG', 'RGBA')
    assert len(body) > SEND_BYTES
    sent, media_type = sendable(body, 'image/png')
    assert media_type == 'image/jpeg'
    assert len(sent) <= SEND_BYTES
    with Image.open(io.BytesIO(sent)) as image:
        assert max(image.size) == SEND_EDGE


def test_a_format_claude_does_not_read_is_sent_as_jpeg() -> None:
    sent, media_type = sendable(encoded((200, 200), 'TIFF'), 'image/tiff')
    assert media_type == 'image/jpeg'
    with Image.open(io.BytesIO(sent)) as image:
        assert image.size == (200, 200)
