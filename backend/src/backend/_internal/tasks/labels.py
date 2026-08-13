"""operator-label projection sync.

the labeler (moderation service) is the source of truth for operator labels,
but discovery queries need label state in SQL to filter and paginate sanely.
this task reconciles `tracks.operator_labels` against the labeler the same
way sync_copyright_resolutions reconciles copyright flags.
"""

import logging
from datetime import timedelta

import logfire
from docket import Perpetual
from sqlalchemy import cast, select
from sqlalchemy.dialects.postgresql import JSONB

from backend._internal.atproto.client import parse_at_uri
from backend._internal.content_labels import PROJECTED_LABEL_VALUES
from backend._internal.track_policy import replace_track_moderation_policies
from backend.config import settings
from backend.models import Track, TrackPolicy
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def sync_operator_labels(
    perpetual: Perpetual = Perpetual(every=timedelta(minutes=5), automatic=True),  # noqa: B008
) -> None:
    """reconcile projected operator labels with the labeler.

    asks the labeler for every URI holding an active label of a projected
    value, then updates `tracks.operator_labels` to match — both applying
    new labels and clearing negated ones. raises (skipping the pass) if the
    labeler is unreachable, so an outage can never clear the projection.
    """
    from backend._internal.clients.moderation import get_moderation_client

    client = get_moderation_client()
    labels_by_uri = await client.get_active_labels_by_value(
        sorted(PROJECTED_LABEL_VALUES)
    )
    overrides_by_uri = await client.get_moderation_overrides()

    invalid_overrides = set(overrides_by_uri.values()) - {"allow", "exclude"}
    if invalid_overrides:
        raise ValueError(
            f"unsupported moderation overrides: {sorted(invalid_overrides)!r}"
        )

    subjects: set[str] = set()
    for uri in set(labels_by_uri) | set(overrides_by_uri):
        try:
            repo, collection, rkey = parse_at_uri(uri)
        except (TypeError, ValueError):
            continue
        canonical = f"at://{repo}/{collection}/{rkey}"
        if (
            repo.startswith("did:")
            and rkey
            and uri == canonical
            and collection == settings.atproto.track_collection
        ):
            subjects.add(uri)

    desired_policies = {
        uri: (
            sorted(set(labels_by_uri.get(uri, set())) & PROJECTED_LABEL_VALUES),
            overrides_by_uri.get(uri),
        )
        for uri in subjects
        if labels_by_uri.get(uri) or overrides_by_uri.get(uri) is not None
    }

    async with db_session() as db:
        existing_policies = {
            policy.record_uri: (policy.operator_labels, policy.moderation_decision)
            for policy in (
                await db.scalars(
                    select(TrackPolicy).where(
                        TrackPolicy.moderation_write_source.isnot(None)
                    )
                )
            ).all()
        }
        projection_changed = existing_policies != desired_policies

        # tracks that need updating: currently projected, or newly labeled,
        # or carrying an override in either direction
        result = await db.execute(
            select(Track).where(
                (cast(Track.operator_labels, JSONB) != cast([], JSONB))
                | Track.moderation_override.isnot(None)
                | Track.atproto_record_uri.in_(subjects)
            )
        )
        tracks = result.scalars().all()

        changed = 0
        for track in tracks:
            uri = track.atproto_record_uri or ""
            desired = sorted(labels_by_uri.get(uri, set()))
            desired_override = overrides_by_uri.get(uri)
            if (
                track.operator_labels != desired
                or track.moderation_override != desired_override
            ):
                track.operator_labels = desired
                track.moderation_override = desired_override
                changed += 1

        if projection_changed:
            await replace_track_moderation_policies(db, desired_policies)

        if changed or projection_changed:
            await db.commit()
            logfire.info(
                "sync_operator_labels: updated {count} legacy tracks and {policy_count} canonical policies",
                count=changed,
                policy_count=len(desired_policies),
                labeled_uris=len(labels_by_uri),
            )
        else:
            logfire.debug(
                "sync_operator_labels: projection in sync",
                labeled_uris=len(labels_by_uri),
            )
