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

from backend._internal.content_labels import (
    ACCOUNT_LABEL_VALUES,
    PROJECTED_LABEL_VALUES,
)
from backend.models import Artist, Track
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def sync_operator_labels(
    perpetual: Perpetual = Perpetual(every=timedelta(minutes=5), automatic=True),  # noqa: B008
) -> None:
    """reconcile projected operator labels with the labeler.

    asks the labeler for every subject holding an active label of a projected
    value, then updates `tracks.operator_labels` (record URIs) and
    `artists.operator_labels` (bare DIDs) to match — both applying new labels
    and clearing negated ones. raises (skipping the pass) if the labeler is
    unreachable, so an outage can never clear the projection.
    """
    from backend._internal.clients.moderation import get_moderation_client

    client = get_moderation_client()
    labels_by_subject = await client.get_active_labels_by_value(
        sorted(PROJECTED_LABEL_VALUES | ACCOUNT_LABEL_VALUES)
    )
    overrides_by_uri = await client.get_moderation_overrides()

    labels_by_uri = {
        uri: track_vals
        for uri, vals in labels_by_subject.items()
        if not uri.startswith("did:") and (track_vals := vals & PROJECTED_LABEL_VALUES)
    }
    labels_by_did = {
        did: account_vals
        for did, vals in labels_by_subject.items()
        if did.startswith("did:") and (account_vals := vals & ACCOUNT_LABEL_VALUES)
    }

    async with db_session() as db:
        # tracks that need updating: currently projected, or newly labeled,
        # or carrying an override in either direction
        subjects = set(labels_by_uri) | set(overrides_by_uri)
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

        artist_result = await db.execute(
            select(Artist).where(
                (cast(Artist.operator_labels, JSONB) != cast([], JSONB))
                | Artist.did.in_(labels_by_did)
            )
        )
        for artist in artist_result.scalars().all():
            desired = sorted(labels_by_did.get(artist.did, set()))
            if artist.operator_labels != desired:
                artist.operator_labels = desired
                changed += 1

        if changed:
            await db.commit()
            logfire.info(
                "sync_operator_labels: updated {count} subjects",
                count=changed,
                labeled_uris=len(labels_by_uri),
                labeled_accounts=len(labels_by_did),
            )
        else:
            logfire.debug(
                "sync_operator_labels: projection in sync",
                labeled_uris=len(labels_by_uri),
            )
