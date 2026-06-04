"""Deterministic, per-artist-budgeted rotation sampler.

Turns a scored corpus into a daily rotation that doesn't let one artist stack it:

* **Deterministic per (station, day):** seeded by the station slug + calendar day,
  so every client computes the same rotation for the same day — required by the
  stateless wall-clock loop that existing consumers depend on. It reshuffles once
  a day.

* **Per-artist airtime budget:** once an artist has contributed
  ``ARTIST_AIRTIME_CAP_SECONDS`` of clock time they stop being drawn, so a creator
  with many tracks can't fill the rotation. One budget-crossing track is allowed
  (we can't split a track), so a single long mix can still be one entry — it just
  won't be joined by more from the same artist. Note this caps how *often* an
  artist appears, not the share of any one long track: a 2-hour mix can still be a
  big slice of a single loop. That's a deliberate v1 tradeoff (popular long-form
  content should still feature) and a knob to revisit.

* **Weighted draw without replacement:** tracks are sampled in proportion to their
  lens weight, so the rotation isn't a fixed top-N chart and the long tail turns
  over.
"""

import hashlib
import random

from backend.models import Track

DEFAULT_TRACK_SECONDS = 180
ARTIST_AIRTIME_CAP_SECONDS = 20 * 60  # an artist is done once past ~20 min of airtime
TARGET_ROTATION_SECONDS = 4 * 60 * 60  # aim for ~4 hours of programming per rotation


def _seed(station_slug: str, day: str) -> int:
    digest = hashlib.blake2s(f"{station_slug}:{day}".encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big")


def _track_seconds(track: Track) -> int:
    if track.duration and track.duration > 0:
        return int(track.duration)
    return DEFAULT_TRACK_SECONDS


def build_rotation(
    candidates: list[Track],
    weights: dict[int, float],
    *,
    station_slug: str,
    day: str,
    max_tracks: int,
    target_seconds: int = TARGET_ROTATION_SECONDS,
    artist_airtime_cap_seconds: int = ARTIST_AIRTIME_CAP_SECONDS,
) -> list[Track]:
    """Draw a deterministic, airtime-fair rotation from scored candidates.

    Args:
        candidates: the eligible corpus (already filtered for this station).
        weights: track id -> non-negative lens weight.
        station_slug: identifies the station for the daily seed.
        day: ISO calendar day (UTC); rotation is stable within it.
        max_tracks: hard ceiling on rotation length (the API ``limit``).
        target_seconds: stop once the rotation reaches roughly this much airtime.
        artist_airtime_cap_seconds: per-artist airtime budget before they drop out.
    """
    pool = [t for t in candidates if weights.get(t.id, 0.0) > 0.0]
    if not pool:
        return []

    rng = random.Random(_seed(station_slug, day))
    remaining = pool[:]
    remaining_weights = [weights[t.id] for t in remaining]

    rotation: list[Track] = []
    artist_airtime: dict[str, int] = {}
    total_seconds = 0

    while remaining and len(rotation) < max_tracks and total_seconds < target_seconds:
        chosen_idx = _weighted_pick(rng, remaining_weights)
        track = remaining.pop(chosen_idx)
        remaining_weights.pop(chosen_idx)

        if artist_airtime.get(track.artist_did, 0) >= artist_airtime_cap_seconds:
            continue  # this artist has already used their airtime budget

        seconds = _track_seconds(track)
        rotation.append(track)
        artist_airtime[track.artist_did] = (
            artist_airtime.get(track.artist_did, 0) + seconds
        )
        total_seconds += seconds

    return rotation


def _weighted_pick(rng: random.Random, weights: list[float]) -> int:
    """Index of a weighted random draw. ``weights`` is assumed non-empty/positive."""
    target = rng.random() * sum(weights)
    cumulative = 0.0
    for idx, weight in enumerate(weights):
        cumulative += weight
        if target < cumulative:
            return idx
    return len(weights) - 1
