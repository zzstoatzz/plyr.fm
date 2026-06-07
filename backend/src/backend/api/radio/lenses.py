"""Station lenses — the scoring strategies that make stations feel different.

A lens turns a track + context into a **score** (higher = more on-axis for that
station). The caller ranks the eligible corpus by that score and weights the
sampler by rank-decay, so a lens only needs to produce a sensible *ordering* — raw
magnitudes don't matter and one station's signal can't swamp another's.

The three lenses are deliberately spread across orthogonal axes so flipping
between stations means something:

* ``loved``     — popularity (likes + plays), any age
* ``fresh``     — the *new* end of the catalog (most-recent uploads), nothing else
* ``deep_cuts`` — the *old* end (older tracks that stayed underplayed)
"""

import math
from dataclasses import dataclass
from datetime import UTC, datetime

from backend.models import Track

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
    return ctx.likes(track) * 3 + math.log1p(track.play_count)


def fresh(track: Track, ctx: LensContext) -> float:
    """The leading edge of uploads — purely how recently this track landed.

    Recency is measured by *position* in the newest-first ordering, not wall-clock
    age, so "fresh" tracks whatever just landed whether uploads pour in or trickle.
    Engagement is intentionally ignored: just-landed, not well-liked.
    """
    return -float(ctx.recency_position(track))


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
    return obscurity * maturity + quality_hint
