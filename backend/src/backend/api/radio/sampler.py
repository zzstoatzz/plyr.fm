"""Deterministic, per-artist-budgeted rotation sampler.

Turns a scored corpus into a rotation that doesn't let one artist stack it:

* **Deterministic per (station, period):** seeded by the station slug + a rotation
  period, so every client computes the same rotation for the same period —
  required by the stateless wall-clock loop that existing consumers depend on.
  The caller picks the period granularity (currently a few hours, so a listener
  with a fixed daily listening window doesn't land on the same slice every day).

* **Per-artist airtime budget:** once an artist has contributed
  ``ARTIST_AIRTIME_CAP_SECONDS`` of clock time they stop being drawn, so a creator
  with many tracks can't fill the rotation. One budget-crossing track is allowed
  (we can't split a track), so a single long mix can still be one entry — it just
  won't be joined by more from the same artist. Note this caps how *often* an
  artist appears, not the share of any one long track: a 2-hour mix can still be a
  big slice of a single loop. That's a deliberate v1 tradeoff (popular long-form
  content should still feature) and a knob to revisit.

* **Artist spacing:** an artist can't land within ``ARTIST_SPACING`` entries of
  their own previous one, so back-to-back (or near-back-to-back) plays by the same
  creator never reach a listener. The airtime budget bounds how *much* an artist
  gets across a rotation; spacing bounds how *clustered* it is. Spacing relaxes
  only when no other artist is drawable, so a thin corpus still fills a rotation.

* **Weighted draw without replacement:** tracks are sampled in proportion to their
  lens weight, so the rotation isn't a fixed top-N chart and the long tail turns
  over.

* **Exploration floor:** a fraction of draws ignore the lens weights and pick
  uniformly from whatever hasn't been drawn yet. Rank-decay weights alone leave
  everything past the head effectively unreachable (with a static ranking, ~90%
  of the corpus never airs); the floor guarantees the dormant tail cycles through
  while the lens still shapes most of the rotation.
"""

import hashlib
import math
import random

from backend.models import Track

DEFAULT_TRACK_SECONDS = 180
ARTIST_AIRTIME_CAP_SECONDS = 20 * 60  # an artist is done once past ~20 min of airtime
TARGET_ROTATION_SECONDS = 4 * 60 * 60  # aim for ~4 hours of programming per rotation
EXPLORATION_FRACTION = 0.25  # share of draws that ignore lens weights entirely
ARTIST_SPACING = 3  # entries an artist must wait before they can air again


def rank_decay_weights(ranked_ids: list[int], scale: float) -> dict[int, float]:
    """Weight items by their position in ``ranked_ids`` (0 = best) as exp(-rank/scale).

    Weighting by *rank* rather than raw score bounds the total tail mass (~scale)
    regardless of list length, so a long low-rank tail can't out-mass the head —
    e.g. hundreds of old tracks can't collectively outweigh the few fresh ones.
    """
    return {item: math.exp(-rank / scale) for rank, item in enumerate(ranked_ids)}


def _seed(station_slug: str, period: str) -> int:
    digest = hashlib.blake2s(
        f"{station_slug}:{period}".encode(), digest_size=8
    ).digest()
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
    period: str,
    max_tracks: int,
    target_seconds: int = TARGET_ROTATION_SECONDS,
    artist_airtime_cap_seconds: int = ARTIST_AIRTIME_CAP_SECONDS,
    exploration: float = EXPLORATION_FRACTION,
    artist_spacing: int = ARTIST_SPACING,
) -> list[Track]:
    """Draw a deterministic, airtime-fair rotation from scored candidates.

    Args:
        candidates: the eligible corpus (already filtered for this station).
        weights: track id -> non-negative lens weight.
        station_slug: identifies the station for the rotation seed.
        period: opaque rotation-period key; rotation is stable within it.
        max_tracks: hard ceiling on rotation length (the API ``limit``).
        target_seconds: stop once the rotation reaches roughly this much airtime.
        artist_airtime_cap_seconds: per-artist airtime budget before they drop out.
        exploration: probability that a draw is uniform over the remaining pool
            instead of lens-weighted, so the tail is reachable.
        artist_spacing: minimum number of entries between two airings by the same
            artist; relaxed when no other artist can be drawn.
    """
    pool = [t for t in candidates if weights.get(t.id, 0.0) > 0.0]
    if not pool:
        return []

    rng = random.Random(_seed(station_slug, period))
    remaining = pool[:]
    remaining_weights = [weights[t.id] for t in remaining]

    rotation: list[Track] = []
    artist_airtime: dict[str, int] = {}
    total_seconds = 0

    while remaining and len(rotation) < max_tracks and total_seconds < target_seconds:
        # drawing from an eligible subset rather than drawing-then-rejecting keeps
        # a dominant artist from burning the draws that should have aired others.
        blocked = {t.artist_did for t in rotation[-artist_spacing:]}
        eligible = [
            idx
            for idx, t in enumerate(remaining)
            if artist_airtime.get(t.artist_did, 0) < artist_airtime_cap_seconds
            and t.artist_did not in blocked
        ]
        if not eligible:
            eligible = [
                idx
                for idx, t in enumerate(remaining)
                if artist_airtime.get(t.artist_did, 0) < artist_airtime_cap_seconds
            ]
        if not eligible:
            break

        if rng.random() < exploration:
            chosen_idx = eligible[rng.randrange(len(eligible))]
        else:
            chosen_idx = eligible[
                _weighted_pick(rng, [remaining_weights[idx] for idx in eligible])
            ]
        track = remaining.pop(chosen_idx)
        remaining_weights.pop(chosen_idx)

        seconds = _track_seconds(track)
        rotation.append(track)
        artist_airtime[track.artist_did] = (
            artist_airtime.get(track.artist_did, 0) + seconds
        )
        total_seconds += seconds

    # the rotation is a loop, so its tail plays into its head: trim trailing
    # entries that would collide across that seam.
    # a corpus too thin to satisfy spacing at all (one artist) has no seam to fix,
    # and trimming it would only shorten the loop.
    for _ in range(artist_spacing):
        if (
            len(rotation) <= artist_spacing + 1
            or len({t.artist_did for t in rotation}) < 2
            or not _seam_collides(rotation, artist_spacing)
        ):
            break
        rotation.pop()

    return rotation


def _seam_collides(rotation: list[Track], artist_spacing: int) -> bool:
    """Whether the loop's tail repeats an artist within ``artist_spacing`` of its head."""
    return any(
        rotation[-tail].artist_did == rotation[head].artist_did
        for tail in range(1, artist_spacing + 1)
        for head in range(artist_spacing - tail + 1)
    )


def _weighted_pick(rng: random.Random, weights: list[float]) -> int:
    """Index of a weighted random draw. ``weights`` is assumed non-empty/positive."""
    target = rng.random() * sum(weights)
    cumulative = 0.0
    for idx, weight in enumerate(weights):
        cumulative += weight
        if target < cumulative:
            return idx
    return len(weights) - 1
