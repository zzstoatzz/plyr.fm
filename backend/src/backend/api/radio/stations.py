"""Station registry — the small, curated lineup you flip between.

A station is just a name + a lens (and, later, an optional corpus filter). Keeping
the lineup deliberately small is the point: a constrained set you look forward to,
not an infinite dial. New stations are added here; the default is what existing
``/radio/state`` consumers see and can be swapped without touching the API shape.
"""

from collections.abc import Callable
from dataclasses import dataclass

from backend.api.radio import lenses
from backend.api.radio.lenses import LensContext
from backend.models import Track

Lens = Callable[[Track, LensContext], float]


@dataclass(frozen=True)
class Station:
    slug: str
    name: str
    description: str
    lens: Lens


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
        description="newly uploaded — what just landed on plyr.fm",
        lens=lenses.fresh,
    ),
    Station(
        slug="discovery",
        name="discovery",
        description="deep cuts and overlooked tracks from across the catalog",
        lens=lenses.discovery,
    ),
)

DEFAULT_STATION_SLUG = "loved"

_BY_SLUG = {station.slug: station for station in STATIONS}


def get_station(slug: str | None) -> Station | None:
    """Resolve a station by slug; ``None`` slug yields the default station."""
    if slug is None:
        return _BY_SLUG[DEFAULT_STATION_SLUG]
    return _BY_SLUG.get(slug)
