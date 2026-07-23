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

from backend._internal.content_labels import PROJECTED_LABEL_VALUES
from backend.models import Track
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

    async with db_session() as db:
        # tracks that need updating: currently projected, or newly labeled
        result = await db.execute(
            select(Track).where(
                (cast(Track.operator_labels, JSONB) != cast([], JSONB))
                | Track.atproto_record_uri.in_(labels_by_uri.keys())
            )
        )
        tracks = result.scalars().all()

        changed = 0
        for track in tracks:
            desired = sorted(labels_by_uri.get(track.atproto_record_uri or "", set()))
            if track.operator_labels != desired:
                track.operator_labels = desired
                changed += 1

        if changed:
            await db.commit()
            logfire.info(
                "sync_operator_labels: updated {count} tracks",
                count=changed,
                labeled_uris=len(labels_by_uri),
            )
        else:
            logfire.debug(
                "sync_operator_labels: projection in sync",
                labeled_uris=len(labels_by_uri),
            )
