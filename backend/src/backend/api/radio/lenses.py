"""Station lenses — the scoring strategies that make stations feel different.

A lens turns a track + context into a non-negative weight. The sampler then draws
a deterministic, airtime-fair rotation from those weights, so a lens decides
*flavor* (what this station leans toward) while the sampler decides *fairness and
rotation* (no one artist hogging the clock, genuine day-to-day variety).

All weights carry a small floor so nothing in the corpus is ever strictly
impossible — that floor is what keeps a station from collapsing into a fixed
top-N playlist.
"""

import math
from dataclasses import dataclass
from datetime import UTC, datetime

from backend.models import Track

WEIGHT_FLOOR = 0.05


@dataclass(frozen=True)
class LensContext:
    """Per-request signals shared across every track in a lens evaluation."""

    like_counts: dict[int, int]
    now: datetime

    def likes(self, track: Track) -> int:
        return self.like_counts.get(track.id, 0)

    def age_days(self, track: Track) -> float:
        created = track.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        return max(0.0, (self.now - created).total_seconds() / 86400.0)


def loved(track: Track, ctx: LensContext) -> float:
    """Genuinely liked + played. Closest to the historical radio behavior."""
    return WEIGHT_FLOOR + ctx.likes(track) * 3 + math.log1p(track.play_count)


def fresh(track: Track, ctx: LensContext) -> float:
    """Recency-leaning. New uploads surface, engagement is a tiebreak nudge."""
    # ~2-week half-life so the station keeps turning over toward new material.
    recency = math.exp(-ctx.age_days(track) / 14.0)
    nudge = math.log1p(ctx.likes(track) + track.play_count) * 0.15
    return WEIGHT_FLOOR + recency + nudge


def discovery(track: Track, ctx: LensContext) -> float:
    """Deep cuts — the long tail the other lenses never reach.

    Up-weights low-play tracks so the ~40% of the catalog that the old recency
    cap made unreachable actually gets airtime. A faint like signal keeps it from
    being pure noise without re-privileging the already-popular.
    """
    obscurity = 1.0 / (1.0 + math.log1p(track.play_count))
    quality_hint = math.log1p(ctx.likes(track)) * 0.1
    return WEIGHT_FLOOR + obscurity + quality_hint
