"""Eligible-track loading for radio.

The whole catalog of public, ungated tracks is the corpus. There is deliberately
no recency cap here: stations reach the full library and the sampler decides what
actually rotates. (The previous implementation only ever considered the 500 most
recent tracks, which made ~40% of the catalog unreachable on radio.)
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal.content_labels import (
    get_track_label_values,
    has_adult_audio_label,
)
from backend.models import Artist, Track


async def load_corpus(db: AsyncSession) -> list[Track]:
    """Load every public, ungated track with its artist eager-loaded."""
    stmt = (
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist))
        .where(
            Track.in_discovery,
            Track.support_gate.is_(None),
            Artist.deactivated == False,  # noqa: E712
        )
        .order_by(Track.created_at.desc(), Track.id.desc())
    )
    result = await db.execute(stmt)
    tracks = list(result.scalars().all())
    labels_by_id = await get_track_label_values(tracks)
    # Radio is a shared wall-clock rotation, including anonymous embeds. It
    # cannot vary by listener preference, so adult audio never enters it.
    return [
        track
        for track in tracks
        if not has_adult_audio_label(labels_by_id.get(track.id, set()))
    ]
