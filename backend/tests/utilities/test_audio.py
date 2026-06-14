"""tests for audio byte-level helpers."""

from backend.utilities.audio import is_alac


def test_is_alac_returns_false_on_unreadable_bytes() -> None:
    """conservative default: unidentifiable bytes must NOT be flagged as ALAC.

    a false positive would needlessly force a transcode (and publish the source
    as an interim that may already be web-playable). mutagen returns None for
    garbage, and the helper must swallow that into False rather than raise."""
    assert is_alac(b"not an audio file") is False
    assert is_alac(b"") is False
