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
# given a track's normalized tags, is it eligible for this station?
CorpusFilter = Callable[[set[str]], bool]


def _has_hidden_tag(tags: set[str]) -> bool:
    """True if the track carries any default-hidden tag (ai / ai-slop / suno)."""
    return any(is_tag_hidden_by_default(tag) for tag in tags)


def _exclude_slop(tags: set[str]) -> bool:
    return not _has_hidden_tag(tags)


def _only_slop(tags: set[str]) -> bool:
    return _has_hidden_tag(tags)


@dataclass(frozen=True)
class Station:
    slug: str
    name: str
    description: str
    lens: Lens
    # default: keep the same ai/suno tracks out that the homepage hides
    corpus_filter: CorpusFilter = field(default=_exclude_slop)


STATIONS: tuple[Station, ...] = (
    Station(
        slug="loved",
        name="loved",
        description="the most-liked, most-played tracks across plyr.fm",
        lens=lenses.loved,
    ),
    Station(
        slug="fresh",
        name="fresh",
        description="just landed — the newest uploads on plyr.fm",
        lens=lenses.fresh,
    ),
    Station(
        slug="deep-cuts",
        name="deep cuts",
        description="older, overlooked tracks from the back catalog",
        lens=lenses.deep_cuts,
    ),
    Station(
        slug="slop",
        name="slop",
        description="ai-generated tracks — hidden from the other stations",
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
