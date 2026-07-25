"""Publish moderation decisions to @moderation.plyr.fm.

Walks the moderation event log forward from a cursor and posts the decisions
that are publishable (see `_internal/transparency`). Runs in the backend rather
than the moderation service because the Bluesky session already lives here —
and reading the log on a timer keeps the dependency pointing one way, the same
shape as sync_operator_labels.

Two safety properties matter more than throughput:

**It cannot backfill.** On first run the cursor is initialised to the log's
current head, so events that predate the publisher are never announced.
Posting about decisions from months ago because a publisher shipped today would
be the same mistake as DMing uploaders about old flags.

**It is off by default.** `notify.publish_moderation_decisions` gates actual
posting. When disabled the task still runs and logs each rendered post, so the
pipeline is observable and testable without anything reaching the timeline —
which also keeps staging, which shares this Bluesky account, from posting about
test data.
"""

import logging
from datetime import timedelta

import logfire
from docket import Perpetual

from backend._internal.transparency import TransparencyPost, render
from backend.config import settings
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

CURSOR_KEY = "plyr:moderation-transparency:cursor"
BATCH_LIMIT = 25


async def publish_moderation_decisions(
    perpetual: Perpetual = Perpetual(every=timedelta(minutes=2), automatic=True),  # noqa: B008
) -> None:
    """Post new moderation decisions, oldest first."""
    from backend._internal.clients.moderation import get_moderation_client
    from backend._internal.notifications import notification_service

    if not settings.moderation.auth_token:
        return

    client = get_moderation_client()
    redis = get_async_redis_client()

    raw_cursor = await redis.get(CURSOR_KEY)
    if raw_cursor is None:
        # first run: start at the head so history is never announced
        head = await client.get_events_head()
        await redis.set(CURSOR_KEY, str(head))
        logfire.info(
            "transparency publisher initialised at head; no backfill",
            head=head,
        )
        return

    cursor = int(raw_cursor)
    events = await client.get_events_since(cursor, limit=BATCH_LIMIT)
    if not events:
        return

    posted = 0
    skipped = 0
    for event in events:
        post: TransparencyPost | None = render(event)
        if post is None:
            skipped += 1
        elif settings.notify.publish_moderation_decisions:
            if await notification_service.post_publicly(post.text):
                posted += 1
            else:
                # stop at the failure so the cursor does not skip past a
                # decision that was never announced
                logger.warning(
                    "transparency post failed at event %d; stopping batch",
                    event["id"],
                )
                break
        else:
            logfire.info(
                "transparency post (publishing disabled)",
                event_id=event["id"],
                action=event["action"],
                text=post.text,
            )
            posted += 1
        cursor = event["id"]

    await redis.set(CURSOR_KEY, str(cursor))
    logfire.info(
        "transparency publisher pass complete",
        cursor=cursor,
        posted=posted,
        skipped_not_publishable=skipped,
        publishing_enabled=settings.notify.publish_moderation_decisions,
    )
