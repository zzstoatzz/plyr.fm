"""Reconcile indexed creator self-labels from canonical public PDS records."""

import argparse
import asyncio
from dataclasses import dataclass

from sqlalchemy import select

from backend._internal.atproto.records.fm_plyr.track import (
    get_record_public_resilient,
)
from backend._internal.atproto.self_labels import self_label_values_from_record
from backend.models import Artist, Track
from backend.utilities.database import db_session


@dataclass(frozen=True)
class TrackSubject:
    """Minimal immutable input for one public record fetch."""

    track_id: int
    uri: str
    pds_url: str | None
    current_labels: list[str]


@dataclass(frozen=True)
class Reconciliation:
    """One fetched creator-label result."""

    subject: TrackSubject
    labels: list[str] | None
    error: str | None = None


async def fetch_labels(
    subject: TrackSubject, semaphore: asyncio.Semaphore
) -> Reconciliation:
    """Fetch and parse one canonical track record with bounded concurrency."""
    try:
        async with semaphore:
            record, _ = await get_record_public_resilient(subject.uri, subject.pds_url)
        value = record.get("value", {})
        labels = self_label_values_from_record(
            value.get("labels") if isinstance(value, dict) else None
        )
        return Reconciliation(subject=subject, labels=labels)
    except Exception as exc:
        return Reconciliation(subject=subject, labels=None, error=str(exc))


async def run(*, apply: bool, track_id: int | None, limit: int | None) -> None:
    """Fetch public records, report differences, and optionally persist them."""
    async with db_session() as db:
        query = (
            select(Track, Artist.pds_url)
            .join(Artist, Artist.did == Track.artist_did)
            .where(Track.atproto_record_uri.like("at://%"))
            .order_by(Track.id)
        )
        if track_id is not None:
            query = query.where(Track.id == track_id)
        if limit is not None:
            query = query.limit(limit)
        rows = (await db.execute(query)).all()
        subjects = [
            TrackSubject(
                track_id=track.id,
                uri=track.atproto_record_uri,
                pds_url=pds_url,
                current_labels=list(track.self_labels or []),
            )
            for track, pds_url in rows
            if track.atproto_record_uri is not None
        ]

    semaphore = asyncio.Semaphore(10)
    results = await asyncio.gather(
        *(fetch_labels(subject, semaphore) for subject in subjects)
    )
    changes = [
        result
        for result in results
        if result.labels is not None and result.labels != result.subject.current_labels
    ]
    failures = [result for result in results if result.error is not None]

    for result in changes:
        print(
            f"track {result.subject.track_id}: "
            f"{result.subject.current_labels} -> {result.labels}"
        )
    for result in failures:
        print(f"track {result.subject.track_id}: fetch failed: {result.error}")

    if apply and changes:
        by_id = {
            result.subject.track_id: result.labels
            for result in changes
            if result.labels is not None
        }
        async with db_session() as db:
            tracks = (
                await db.execute(select(Track).where(Track.id.in_(by_id)))
            ).scalars()
            for track in tracks:
                track.self_labels = by_id[track.id]
            await db.commit()

    mode = "applied" if apply else "dry-run"
    print(
        f"{mode}: scanned={len(subjects)} changed={len(changes)} failed={len(failures)}"
    )


def main() -> None:
    """Parse CLI arguments and run the async reconciliation."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="persist differences (default: dry-run)"
    )
    parser.add_argument("--track-id", type=int, help="reconcile one track")
    parser.add_argument("--limit", type=int, help="limit records for a test run")
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply, track_id=args.track_id, limit=args.limit))


if __name__ == "__main__":
    main()
