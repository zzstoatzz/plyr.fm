import io
from types import SimpleNamespace

import pytest
from PIL import Image

from plyr_osprey.image_scan import SEND_BYTES, SEND_EDGE, Verdict, sendable, verdict_from


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


def answer(stop_reason: str, text: str | None) -> SimpleNamespace:
    content = [SimpleNamespace(type='text', text=text)] if text is not None else []
    return SimpleNamespace(stop_reason=stop_reason, content=content)


def test_claude_answers_become_a_verdict() -> None:
    found = verdict_from(
        answer(
            'end_turn',
            '{"is_safe": false, "violated_categories": ["explicit_sexual"], "severity": "high", "explanation": "nudity"}',
        )
    )
    assert found == Verdict(is_safe=False, severity='high', categories=['explicit_sexual'], reason='nudity')
    assert found.describe() == 'high: explicit_sexual: nudity'


def test_a_refused_or_cut_off_check_is_a_failed_scan_not_a_clean_one() -> None:
    for stopped in ('refusal', 'max_tokens'):
        with pytest.raises(RuntimeError):
            verdict_from(answer(stopped, '{"is_safe": true}'))
    with pytest.raises(TypeError):
        verdict_from(answer('end_turn', None))
