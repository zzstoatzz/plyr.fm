"""Tests for public moderation transparency posts.

The publishability policy is the part with consequences: publishing a
suspicion is both a legal problem (knowledge without action) and unfair to an
uploader whose track matched a fingerprint and turned out to be their own
cover. These tests pin what may and may not reach the timeline.
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend._internal.tasks.transparency import (
    CURSOR_KEY,
    publish_moderation_decisions,
)
from backend._internal.transparency import PUBLISHABLE_ACTIONS, is_publishable, render


def _event(action: str, **kwargs) -> dict:
    return {
        "id": kwargs.pop("id", 1),
        "action": action,
        "subject_uri": "at://did:plc:x/fm.plyr.track/abc",
        "subject_track_id": kwargs.pop("track_id", 42),
        "actor": "moderator",
        "reason": kwargs.pop("reason", None),
        "notes": kwargs.pop("notes", None),
    }


@pytest.mark.parametrize(
    "action",
    ["flagged_by_scan", "reported", "acknowledged", "override_allow", "override_clear"],
)
def test_suspicions_and_non_actions_are_never_published(action: str) -> None:
    """A flag is not a finding, and a report is not a verdict.

    Announcing either exposes an uploader before anyone reviewed anything --
    and in the report case would turn the report button into a way to publicly
    stain a rival.
    """
    assert not is_publishable(_event(action))
    assert render(_event(action)) is None


@pytest.mark.parametrize("action", sorted(PUBLISHABLE_ACTIONS))
def test_actions_taken_are_published(action: str) -> None:
    post = render(_event(action))
    assert post is not None
    assert "moderation:" in post.text


def test_post_never_names_the_uploader_or_reporter() -> None:
    """Transparency, not punishment: no @-mention to notify and amplify."""
    post = render(
        _event("takedown", reason="copyright", notes="reported by @someone.bsky.social")
    )
    assert post is not None
    assert "@" not in post.text
    assert "someone" not in post.text


def test_post_links_the_track_and_states_the_reason() -> None:
    post = render(_event("override_exclude", reason="fingerprint_match", track_id=64))
    assert post is not None
    assert "https://plyr.fm/track/64" in post.text
    assert "fingerprint match" in post.text


def test_post_stays_within_the_bluesky_limit() -> None:
    post = render(_event("takedown", reason="x" * 500))
    assert post is not None
    assert len(post.text) <= 300


async def test_first_run_starts_at_head_and_posts_nothing() -> None:
    """The publisher must never announce decisions that predate it.

    Seventeen events existed before this shipped, including backfilled flags
    and verification actions. Starting a cursor at zero would have narrated all
    of them.
    """
    redis = AsyncMock()
    redis.get.return_value = None

    with (
        patch(
            "backend._internal.tasks.transparency.get_async_redis_client",
            return_value=redis,
        ),
        patch(
            "backend._internal.clients.moderation.get_moderation_client"
        ) as mock_get_client,
        patch("backend._internal.notifications.notification_service") as mock_notifier,
        patch("backend._internal.tasks.transparency.settings") as mock_settings,
    ):
        mock_settings.moderation.auth_token = "token"
        mock_settings.notify.publish_moderation_decisions = True
        client = AsyncMock()
        client.get_events_head.return_value = 17
        mock_get_client.return_value = client
        mock_notifier.post_publicly = AsyncMock()

        await publish_moderation_decisions()

    redis.set.assert_awaited_once_with(CURSOR_KEY, "17")
    client.get_events_since.assert_not_awaited()
    mock_notifier.post_publicly.assert_not_awaited()


async def test_disabled_publishing_advances_the_cursor_without_posting() -> None:
    """Staging shares the Bluesky account, so it must observe without posting."""
    redis = AsyncMock()
    redis.get.return_value = "5"

    with (
        patch(
            "backend._internal.tasks.transparency.get_async_redis_client",
            return_value=redis,
        ),
        patch(
            "backend._internal.clients.moderation.get_moderation_client"
        ) as mock_get_client,
        patch("backend._internal.notifications.notification_service") as mock_notifier,
        patch("backend._internal.tasks.transparency.settings") as mock_settings,
    ):
        mock_settings.moderation.auth_token = "token"
        mock_settings.notify.publish_moderation_decisions = False
        client = AsyncMock()
        client.get_events_since.return_value = [_event("takedown", id=6)]
        mock_get_client.return_value = client
        mock_notifier.post_publicly = AsyncMock(return_value=True)

        await publish_moderation_decisions()

    mock_notifier.post_publicly.assert_not_awaited()
    redis.set.assert_awaited_with(CURSOR_KEY, "6")


async def test_a_failed_post_stops_the_batch() -> None:
    """The cursor must not step past an announcement that never happened."""
    redis = AsyncMock()
    redis.get.return_value = "5"

    with (
        patch(
            "backend._internal.tasks.transparency.get_async_redis_client",
            return_value=redis,
        ),
        patch(
            "backend._internal.clients.moderation.get_moderation_client"
        ) as mock_get_client,
        patch("backend._internal.notifications.notification_service") as mock_notifier,
        patch("backend._internal.tasks.transparency.settings") as mock_settings,
    ):
        mock_settings.moderation.auth_token = "token"
        mock_settings.notify.publish_moderation_decisions = True
        client = AsyncMock()
        client.get_events_since.return_value = [
            _event("takedown", id=6),
            _event("takedown", id=7),
        ]
        mock_get_client.return_value = client
        mock_notifier.post_publicly = AsyncMock(return_value=False)

        await publish_moderation_decisions()

    # cursor stays at 5: event 6 was never announced, so it must be retried
    redis.set.assert_awaited_with(CURSOR_KEY, "5")


async def test_unpublishable_events_advance_the_cursor() -> None:
    """A queue full of flags must not wedge the publisher."""
    redis = AsyncMock()
    redis.get.return_value = "5"

    with (
        patch(
            "backend._internal.tasks.transparency.get_async_redis_client",
            return_value=redis,
        ),
        patch(
            "backend._internal.clients.moderation.get_moderation_client"
        ) as mock_get_client,
        patch("backend._internal.notifications.notification_service") as mock_notifier,
        patch("backend._internal.tasks.transparency.settings") as mock_settings,
    ):
        mock_settings.moderation.auth_token = "token"
        mock_settings.notify.publish_moderation_decisions = True
        client = AsyncMock()
        client.get_events_since.return_value = [
            _event("flagged_by_scan", id=6),
            _event("reported", id=7),
        ]
        mock_get_client.return_value = client
        mock_notifier.post_publicly = AsyncMock(return_value=True)

        await publish_moderation_decisions()

    mock_notifier.post_publicly.assert_not_awaited()
    redis.set.assert_awaited_with(CURSOR_KEY, "7")
