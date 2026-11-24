"""what a fingerprint scan's matches are evidence of.

ported from prod (backend/src/backend/utilities/copyright_evidence.py), whose
docs/internal/moderation/copyright-detection.md has the measurements behind
the bar. AuDD samples the upload every `SEGMENT_SECONDS` and reports, per
sample, the reference recordings it resembles and where in each one
(`timecode`). a recording that is really there plays through: successive
samples land at successive positions in the same reference. coincidental
matches don't.
"""

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

SEGMENT_SECONDS = 12
MIN_IN_STEP_SEGMENTS = 4
IN_STEP_TOLERANCE_SECONDS = 8
MIN_REPEATED_SEGMENTS = 6
MIN_REPEATED_SHARE = 0.8
_SELF_MATCH_MIN_SLUG_LEN = 4


@dataclass(frozen=True)
class SongEvidence:
    """one reference recording found in an upload."""

    artist: str
    title: str
    segments: int
    in_step_segments: int
    start_seconds: int
    end_seconds: int

    def describe(self) -> str:
        return f'{self.artist} - {self.title} ({_clock(self.start_seconds)}-{_clock(self.end_seconds)})'


def _clock(seconds: int) -> str:
    return f'{seconds // 60}:{seconds % 60:02d}'


def _timecode_seconds(timecode: Any) -> int | None:
    if not isinstance(timecode, str):
        return None
    try:
        parts = [int(p) for p in timecode.split(':')]
    except ValueError:
        return None
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return None


def _in_step(positions: set[tuple[int, int]]) -> set[int]:
    """largest set of upload offsets whose reference position advances with them."""
    by_lag = sorted((offset - timecode, offset) for offset, timecode in positions)
    best: set[int] = set()
    for i, (lag, _) in enumerate(by_lag):
        window = {offset for other_lag, offset in by_lag[i:] if other_lag - lag <= IN_STEP_TOLERANCE_SECONDS}
        if len(window) > len(best):
            best = window
    return best


def song_evidence(matches: list[dict[str, Any]], stride: int = 1) -> list[SongEvidence]:
    """reference recordings the matches show to be present, strongest first.

    `stride` is how sparsely the file was sampled (fingerprint.ScanPlan): one
    chunk in every `stride`. sampled, three samples in step span the same
    48 seconds (or more) that four successive chunks do.
    """
    min_in_step = MIN_IN_STEP_SEGMENTS if stride <= 1 else 3
    min_repeated = MIN_REPEATED_SEGMENTS if stride <= 1 else max(3, math.ceil(MIN_REPEATED_SEGMENTS / stride))
    positions: dict[tuple[str, str], set[tuple[int, int]]] = defaultdict(set)
    names: dict[tuple[str, str], tuple[str, str]] = {}
    for match in matches:
        offset_ms = match.get('offset_ms')
        timecode = _timecode_seconds(match.get('timecode'))
        if not isinstance(offset_ms, int) or timecode is None:
            continue
        artist = (match.get('artist') or '').strip()
        title = (match.get('title') or '').strip()
        key = (artist.lower(), title.lower())
        names.setdefault(key, (artist, title))
        positions[key].add((offset_ms // 1000, timecode))

    scanned = {offset for song in positions.values() for offset, _ in song}
    evidence: list[SongEvidence] = []
    for key, song in positions.items():
        offsets = {offset for offset, _ in song}
        in_step = _in_step(song)
        played_through = len(in_step) >= min_in_step
        repeated = len(offsets) >= min_repeated and len(offsets) >= MIN_REPEATED_SHARE * len(scanned)
        if not (played_through or repeated):
            continue
        span = in_step if played_through else offsets
        artist, title = names[key]
        evidence.append(
            SongEvidence(
                artist=artist,
                title=title,
                segments=len(offsets),
                in_step_segments=len(in_step),
                start_seconds=min(span),
                end_seconds=max(span) + SEGMENT_SECONDS,
            )
        )
    return sorted(evidence, key=lambda e: (-e.in_step_segments, -e.segments))


def _slug(name: str) -> str:
    return ''.join(c for c in name.lower() if c.isalnum())


def is_self_match(match_artist: str, uploader_handle: str, uploader_name: str) -> bool:
    """whether a matched recording is the uploader's own (e.g. "Floby IV" uploaded by flo.by).

    AuDD often finds an artist's own catalog published elsewhere; that's not a
    finding. slugs are compared both ways so stage-name variants match, with a
    minimum length so short names don't match by accident.
    """
    m = _slug(match_artist)
    if len(m) < _SELF_MATCH_MIN_SLUG_LEN:
        return False
    for candidate in (uploader_handle, uploader_name):
        c = _slug(candidate or '')
        if len(c) >= _SELF_MATCH_MIN_SLUG_LEN and (c in m or m in c):
            return True
    return False


def others_playing_through(
    matches: list[dict[str, Any]], handle: str, name: str, stride: int = 1
) -> list[SongEvidence]:
    return [e for e in song_evidence(matches, stride) if not is_self_match(e.artist, handle, name)]
