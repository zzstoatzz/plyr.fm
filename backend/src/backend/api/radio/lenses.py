"""Station lenses — the scoring strategies that make stations feel different.

A lens turns a track + context into a non-negative weight. The sampler then draws
a deterministic, airtime-fair rotation from those weights, so a lens decides
*flavor* (what this station leans toward) while the sampler decides *fairness and
rotation* (no one artist hogging the clock, genuine day-to-day variety).

The three lenses are deliberately spread across orthogonal axes so flipping
between stations means something:

* ``loved``     — popularity (likes + plays), any age
* ``fresh``     — the *new* end of the catalog (most-recent uploads)
* ``deep_cuts`` — the *old* end (older tracks that stayed underplayed)

``fresh`` and ``deep_cuts`` sit at opposite ends of the recency axis on purpose,
so they don't surface the same brand-new-and-unplayed tracks.

All weights carry a small floor so nothing in the corpus is ever strictly
impossible, which keeps a station from collapsing into a fixed top-N. The lenses
lean the right way; they don't hard-partition.
"""

import math
from dataclasses import dataclass
from datetime import UTC, datetime

from backend.models import Track

WEIGHT_FLOOR = 0.05
# how fast `fresh` falls off down the newest-first ordering; ~the newest two
# dozen uploads carry the station regardless of how fast they arrived.
FRESH_RANK_SCALE = 12.0
# wall-clock days over which a track "matures" into deep-cut eligibility, so a
# just-uploaded track belongs to `fresh`, not here.
DEEP_CUT_MATURITY_DAYS = 30.0


@dataclass(frozen=True)
class LensContext:
    """Per-request signals shared across every track in a lens evaluation."""

    like_counts: dict[int, int]
    now: datetime
    # track id -> 0-based position in the newest-first ordering of the corpus.
    recency_rank: dict[int, int]

    def likes(self, track: Track) -> int:
        return self.like_counts.get(track.id, 0)

    def age_days(self, track: Track) -> float:
        created = track.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        return max(0.0, (self.now - created).total_seconds() / 86400.0)

    def recency_position(self, track: Track) -> int:
        """0 = newest upload; unknown tracks rank at the back of the catalog."""
        return self.recency_rank.get(track.id, len(self.recency_rank))


def loved(track: Track, ctx: LensContext) -> float:
    """Genuinely liked + played. Closest to the historical radio behavior."""
    return WEIGHT_FLOOR + ctx.likes(track) * 3 + math.log1p(track.play_count)


def fresh(track: Track, ctx: LensContext) -> float:
    """The leading edge of uploads.

    Recency is measured by *position* in the newest-first ordering, not wall-clock
    age, so "fresh" tracks whatever just landed whether uploads are pouring in or
    trickling — a quiet week doesn't surface stale tracks and a busy week doesn't
    flatten everything to the same weight.
    """
    recency = math.exp(-ctx.recency_position(track) / FRESH_RANK_SCALE)
    nudge = math.log1p(ctx.likes(track) + track.play_count) * 0.15
    return WEIGHT_FLOOR + recency + nudge


def deep_cuts(track: Track, ctx: LensContext) -> float:
    """The old end of the catalog — tracks that aged without getting played.

    Up-weights low-play tracks (the long tail the recency cap used to hide), but
    only once they've had wall-clock time to be discovered: a brand-new unplayed
    track belongs to ``fresh``, not here, so newness is multiplied out. A faint
    like signal keeps it from being pure noise without re-privileging the popular.
    """
    obscurity = 1.0 / (1.0 + math.log1p(track.play_count))
    maturity = 1.0 - math.exp(-ctx.age_days(track) / DEEP_CUT_MATURITY_DAYS)
    quality_hint = math.log1p(ctx.likes(track)) * 0.1
    return WEIGHT_FLOOR + obscurity * maturity + quality_hint
