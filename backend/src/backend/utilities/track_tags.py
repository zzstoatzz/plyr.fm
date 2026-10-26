"""Transactional projection of PDS track tags."""

import json
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Tag, Track, TrackTag
from backend.utilities.tags import parse_tags_json


def record_tags(record: dict[str, Any]) -> list[str] | None:
    if "tags" not in record:
        return None
    if not isinstance(record["tags"], list):
        raise ValueError("tags must be an array of strings")
    return parse_tags_json(json.dumps(record["tags"]), max_tags=20)


async def indexed_tags(db: AsyncSession, track_id: int) -> list[str]:
    return list(
        await db.scalars(
            select(Tag.name)
            .join(TrackTag)
            .where(TrackTag.track_id == track_id)
            .order_by(Tag.name)
        )
    )


async def project_record_tags(
    db: AsyncSession,
    track: Track,
    record: dict[str, Any],
    *,
    authoritative: bool = False,
    cancel_auto: bool = False,
) -> None:
    tags = record_tags(record)
    extra = dict(track.extra or {})
    if tags is None and not (authoritative or extra.get("tags_pds_synced")):
        return
    tags = tags or []
    previous = await indexed_tags(db, track.id)
    if cancel_auto and set(previous) != set(tags):
        extra.pop("auto_tag", None)
    if not extra.get("tags_pds_synced") and previous and set(previous) != set(tags):
        extra["legacy_tags"] = previous
    await db.execute(delete(TrackTag).where(TrackTag.track_id == track.id))
    for name in sorted(tags):
        await db.execute(
            insert(Tag)
            .values(name=name, created_by_did=track.artist_did)
            .on_conflict_do_nothing(index_elements=[Tag.name])
        )
        tag_id = await db.scalar(select(Tag.id).where(Tag.name == name))
        db.add(TrackTag(track_id=track.id, tag_id=tag_id))
    extra["tags_pds_synced"] = True
    track.extra = extra
