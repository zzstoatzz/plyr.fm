"""what a fingerprint scan's matches are evidence of.

AuDD samples the upload every `SEGMENT_SECONDS` and reports, per sample, the
reference recordings it resembles and where in each recording (`timecode`).
a recording that is actually present plays through: successive samples land
at successive positions in the same reference. coincidental matches do not.
see docs/internal/moderation/copyright-detection.md for the measurements.
"""

from collections import defaultdict
from dataclasses import asdict, dataclass
from typing import Any

SEGMENT_SECONDS = 12
MIN_IN_STEP_SEGMENTS = 4
IN_STEP_TOLERANCE_SECONDS = 8
MIN_REPEATED_SEGMENTS = 6
MIN_REPEATED_SHARE = 0.8


@dataclass(frozen=True)
class SongEvidence:
    """one reference recording found in an upload."""

    artist: str
    title: str
    segments: int
    in_step_segments: int
    start_seconds: int
    end_seconds: int

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _timecode_seconds(timecode: Any) -> int | None:
    if not isinstance(timecode, str):
        return None
    try:
        parts = [int(p) for p in timecode.split(":")]
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
        window = {
            offset
            for other_lag, offset in by_lag[i:]
            if other_lag - lag <= IN_STEP_TOLERANCE_SECONDS
        }
        if len(window) > len(best):
            best = window
    return best


def song_evidence(matches: list[dict[str, Any]]) -> list[SongEvidence]:
    """reference recordings the matches show to be present, strongest first."""
    positions: dict[tuple[str, str], set[tuple[int, int]]] = defaultdict(set)
    names: dict[tuple[str, str], tuple[str, str]] = {}
    for match in matches:
        offset_ms = match.get("offset_ms")
        timecode = _timecode_seconds(match.get("timecode"))
        if not isinstance(offset_ms, int) or timecode is None:
            continue
        artist = (match.get("artist") or "").strip()
        title = (match.get("title") or "").strip()
        key = (artist.lower(), title.lower())
        names.setdefault(key, (artist, title))
        positions[key].add((offset_ms // 1000, timecode))

    scanned = {offset for song in positions.values() for offset, _ in song}
    evidence: list[SongEvidence] = []
    for key, song in positions.items():
        offsets = {offset for offset, _ in song}
        in_step = _in_step(song)
        played_through = len(in_step) >= MIN_IN_STEP_SEGMENTS
        repeated = len(offsets) >= MIN_REPEATED_SEGMENTS and len(
            offsets
        ) >= MIN_REPEATED_SHARE * len(scanned)
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


_SELF_MATCH_MIN_SLUG_LEN = 4


def _slugify_artist(name: str) -> str:
    """lowercase, alphanumeric-only — for fuzzy artist-name comparison."""
    return "".join(c for c in name.lower() if c.isalnum())


def is_self_match(
    match_artist: str, uploader_handle: str, uploader_display: str
) -> bool:
    """detect when a copyright match's artist is the uploader themselves.

    AuDD frequently identifies an artist's own catalog uploads as
    "violations" of their own published works elsewhere (e.g. dominant
    match "Floby IV" on a track uploaded by handle "flo.by"). this is
    a false positive — flagging it spams admin DMs and shows a red
    badge to the artist on their own portal.

    we compare slugified forms (lowercase, alphanumeric only) of the
    match artist against the uploader's handle and display name. a
    bidirectional substring check catches stage-name variants in
    either direction (e.g. "flo.by" → "floby" is contained in
    "Floby IV" → "flobyiv"). minimum length avoids accidental
    matches on very short slugs.
    """
    m = _slugify_artist(match_artist)
    if len(m) < _SELF_MATCH_MIN_SLUG_LEN:
        return False
    for candidate in (uploader_handle, uploader_display):
        if not candidate:
            continue
        c = _slugify_artist(candidate)
        if len(c) >= _SELF_MATCH_MIN_SLUG_LEN and (c in m or m in c):
            return True
    return False
