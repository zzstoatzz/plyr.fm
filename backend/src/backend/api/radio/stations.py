"""Station registry — the small, curated lineup you flip between.

A station is a name + a lens (what it leans toward) + a corpus filter (what's even
eligible). Keeping the lineup small is the point: a constrained set you look
forward to, not an infinite dial. New stations are added here; the default is what
existing ``/radio/state`` consumers see and can be swapped without touching the
API shape.
"""

from collections.abc import Callable
from dataclasses import dataclass, field

from backend.api.radio import lenses
from backend.api.radio.lenses import LensContext
from backend.models import Track
from backend.utilities.tags import is_tag_hidden_by_default

Lens = Callable[[Track, LensContext], float]
# given a track and its normalized tags, is it eligible for this station?
CorpusFilter = Callable[[Track, set[str]], bool]

# the plyr.fm app account, whose ai-tagged changelog/update posts we keep out of
# the slop station for now (they're not music).
PLYR_FM_ACCOUNT_HANDLE = "plyr.fm"


def _has_hidden_tag(tags: set[str]) -> bool:
    """True if the track carries any default-hidden tag (ai / ai-slop / suno)."""
    return any(is_tag_hidden_by_default(tag) for tag in tags)


def _exclude_slop(track: Track, tags: set[str]) -> bool:
    return not _has_hidden_tag(tags)


def _only_slop(track: Track, tags: set[str]) -> bool:
    return _has_hidden_tag(tags) and track.artist.handle != PLYR_FM_ACCOUNT_HANDLE


# how far down a station's lens ranking the sampler meaningfully reaches: weights
# decay as exp(-rank/scale), so roughly the top ~3*scale ranks carry the station.
DEFAULT_RANK_DECAY = 12.0
# share of draws that ignore the lens and pick uniformly from the un-drawn pool,
# so the dormant tail cycles through instead of never airing.
DEFAULT_EXPLORATION = 0.25


@dataclass(frozen=True)
class Station:
    slug: str
    name: str
    description: str
    lens: Lens
    # default: keep the same ai/suno tracks out that the homepage hides
    corpus_filter: CorpusFilter = field(default=_exclude_slop)
    rank_decay: float = DEFAULT_RANK_DECAY
    exploration: float = DEFAULT_EXPLORATION


STATIONS: tuple[Station, ...] = (
    Station(
        slug="loved",
        name="loved",
        description="the most-played tracks on plyr.fm",
        lens=lenses.loved,
    ),
    Station(
        slug="fresh",
        name="fresh",
        description="the newest uploads on plyr.fm",
        lens=lenses.fresh,
        # fresh IS its head — a uniform draw would leak arbitrarily old tracks
        # into "the newest uploads". its turnover comes from uploads, not from
        # exploring the back catalog.
        exploration=0.0,
    ),
    Station(
        slug="deep-cuts",
        name="deep cuts",
        description="underplayed tracks from the back catalog",
        lens=lenses.deep_cuts,
        # the whole point is the long tail — its lens scores are near-ties across
        # hundreds of underplayed tracks, so a tight head would freeze one slice
        # of them into rotation. reach much deeper than the popularity stations.
        rank_decay=48.0,
    ),
    Station(
        slug="slop",
        name="slop",
        description="ai-generated tracks",
        lens=lenses.loved,
        corpus_filter=_only_slop,
    ),
)

DEFAULT_STATION_SLUG = "loved"

_BY_SLUG = {station.slug: station for station in STATIONS}


def get_station(slug: str | None) -> Station | None:
    """Resolve a station by slug; ``None`` slug yields the default station."""
    if slug is None:
        return _BY_SLUG[DEFAULT_STATION_SLUG]
    return _BY_SLUG.get(slug)
