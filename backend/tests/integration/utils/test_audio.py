"""tests for the drone audio generator.

these are plain unit tests (no @pytest.mark.integration) — they don't
need staging or a real backend. they guard the invariant that the
fixture generator produces unique content per call, which is the
property that lets upload integration tests actually exercise the code
path under test instead of finding stale R2 state.
"""

import hashlib

from tests.integration.utils.audio import (
    generate_drone,
    save_drone,
)


def test_generate_drone_produces_unique_content_by_default(tmp_path) -> None:
    """two consecutive calls with identical params produce different bytes.

    if this regresses, every upload integration test silently stops
    exercising the storage pipeline and starts reading whatever stale
    blob the *first* test run wrote. that's the failure mode that masked
    woody.fm's 2026-05-16 outage. see audio.py module docstring.
    """
    a = generate_drone("A4", duration_sec=0.1).read()
    b = generate_drone("A4", duration_sec=0.1).read()
    assert a != b, "generate_drone() must vary content per call by default"


def test_generate_drone_unique_file_ids(tmp_path) -> None:
    """the property `save_drone` exists to provide: unique content-hashed
    file_id per call (so upload tests don't collide on staged R2 keys).
    """
    p1 = save_drone(tmp_path / "a.wav", "A4", duration_sec=0.1)
    p2 = save_drone(tmp_path / "b.wav", "A4", duration_sec=0.1)
    h1 = hashlib.sha256(p1.read_bytes()).hexdigest()
    h2 = hashlib.sha256(p2.read_bytes()).hexdigest()
    assert h1 != h2, "save_drone must produce distinct file_ids on each call"


def test_generate_drone_deterministic_when_phase_pinned() -> None:
    """passing `phase_offset_rad=0.0` produces identical bytes — for callers
    that genuinely need a known checksum (e.g. asserting a fixture against
    a recorded hash). default behavior is randomized; this is the escape
    hatch.
    """
    a = generate_drone("A4", duration_sec=0.1, phase_offset_rad=0.0).read()
    b = generate_drone("A4", duration_sec=0.1, phase_offset_rad=0.0).read()
    assert a == b, "explicit phase pinning must produce deterministic content"


def test_generate_drone_still_produces_valid_wav() -> None:
    """sanity: the randomized output is still a parseable WAV."""
    wav = generate_drone("A4", duration_sec=0.1).read()
    assert wav.startswith(b"RIFF"), "output must be a RIFF WAV"
    assert b"WAVE" in wav[:12]
    assert b"fmt " in wav
    assert b"data" in wav
