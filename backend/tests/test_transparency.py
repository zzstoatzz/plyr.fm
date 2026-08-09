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
from backend._internal.transparency import (
    MAX_POST_CHARS,
    POLICY_URL,
    PUBLISHABLE_ACTIONS,
    is_publishable,
    render,
    render_group,
)


def _links(post) -> list[str]:
    return [s.link for s in post.segments if s.link]


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
    assert "https://plyr.fm/track/64" in _links(post)
    assert "plyr.fm/track/64" in post.text
    assert "fingerprint match" in post.text


def test_post_links_a_policy_page_that_exists() -> None:
    """Every post carries this link, so a dead one is dead on all of them.

    The first cut used plyr.fm/docs/moderation, which 404d; it then pointed at
    the sensitive-content guide, which only covers the adult half.
    """
    post = render(_event("takedown"))
    assert post is not None
    assert POLICY_URL in _links(post)
    assert "plyr.fm/docs/moderation" not in post.text


def test_every_url_is_a_link_not_bare_text() -> None:
    """Bluesky does not infer links from text.

    The first cut emitted a plain string, so both URLs rendered as unclickable
    grey text. A URL that appears in the text must be carried by a segment
    that also has a link, or it is decoration.
    """
    post = render(_event("override_exclude", track_id=1190))
    assert post is not None

    linked_text = {s.text for s in post.segments if s.link}
    for segment in post.segments:
        if segment.link is None:
            assert "plyr.fm" not in segment.text, (
                f"{segment.text!r} mentions a URL but carries no link"
            )
    assert linked_text == {"plyr.fm/track/1190", "docs.plyr.fm/moderation"}


def test_link_text_matches_its_target() -> None:
    """Display text is the URL minus the scheme, as Bluesky's composer shows it.

    Link text that points somewhere other than where it reads is how phishing
    works; on a moderation account it would be especially corrosive.
    """
    post = render(_event("takedown", track_id=7))
    assert post is not None
    for segment in post.segments:
        if segment.link:
            assert segment.link.endswith(segment.text)
            assert segment.link.startswith("https://")


def test_byte_offsets_survive_multibyte_reasons() -> None:
    """Facets index UTF-8 bytes, not characters.

    Segments are assembled in order, so the invariant to hold is that the
    concatenated text equals the post text -- any drift there would shift
    every subsequent facet range.
    """
    post = render(_event("takedown", reason="dépôt non autorisé — ünïcode", track_id=9))
    assert post is not None
    assert "".join(s.text for s in post.segments) == post.text
    rebuilt = post.text.encode("utf-8")
    offset = 0
    for segment in post.segments:
        chunk = segment.text.encode("utf-8")
        assert rebuilt[offset : offset + len(chunk)] == chunk
        offset += len(chunk)
    assert offset == len(rebuilt)


def test_a_long_reason_is_bounded_without_truncating_the_post() -> None:
    """Trimming the assembled text would corrupt every facet after the cut.

    Facets are byte ranges into the post text, so the variable part is bounded
    at the source instead.
    """
    post = render(_event("takedown", reason="x" * 500, track_id=1))
    assert post is not None
    assert len(post.text) <= 300
    # the links still terminate the post, so their ranges are intact
    assert post.segments[-1].link == POLICY_URL


def test_one_decision_on_many_subjects_is_one_post() -> None:
    """Six exclusions of one uploader's catalog are one announcement.

    A post per subject turns a single curation call into a feed flood that
    reads as six separate incidents.
    """
    events = [
        _event("override_exclude", id=10 + i, track_id=660 + i, reason="not_music")
        for i in range(6)
    ]
    posts = render_group(events)
    assert len(posts) == 1
    post = posts[0]
    assert "removed 6 tracks from discovery and radio" in post.text
    assert "not music" in post.text
    assert len(post.text) <= MAX_POST_CHARS
    assert post.event_id == 15
    track_links = [link for link in _links(post) if "/track/" in link]
    assert track_links == [f"https://plyr.fm/track/{660 + i}" for i in range(6)]


def test_a_group_over_the_post_budget_splits_and_stays_ordered() -> None:
    """Splitting is the budget's problem, not the caller's.

    Each post must fit Bluesky's limit, cover its events in id order, and
    carry the last covered id so the cursor can land between chunks.
    """
    events = [
        _event("takedown", id=100 + i, track_id=10_000_000 + i, reason="x" * 120)
        for i in range(20)
    ]
    posts = render_group(events)
    assert len(posts) > 1
    assert all(len(post.text) <= MAX_POST_CHARS for post in posts)
    covered = [link for post in posts for link in _links(post) if "/track/" in link]
    assert covered == [f"https://plyr.fm/track/{10_000_000 + i}" for i in range(20)]
    assert [post.event_id for post in posts] == sorted(post.event_id for post in posts)
    assert posts[-1].event_id == 119


def test_a_single_event_group_keeps_the_singular_headline() -> None:
    posts = render_group([_event("override_exclude", id=1, track_id=64)])
    assert len(posts) == 1
    assert "removed a track from discovery and radio" in posts[0].text


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


async def test_adjacent_same_decision_events_publish_as_one_post() -> None:
    """The publisher groups a batch decision instead of posting per subject."""
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
            _event("override_exclude", id=6 + i, track_id=660 + i, reason="not_music")
            for i in range(6)
        ]
        mock_get_client.return_value = client
        mock_notifier.post_publicly = AsyncMock(return_value=True)

        await publish_moderation_decisions()

    assert mock_notifier.post_publicly.await_count == 1
    redis.set.assert_awaited_with(CURSOR_KEY, "11")


async def test_a_reason_change_breaks_the_group() -> None:
    """Different reasons are different decisions and announce separately."""
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
            _event("override_exclude", id=6, track_id=1, reason="not_music"),
            _event("override_exclude", id=7, track_id=2, reason="fingerprint_match"),
        ]
        mock_get_client.return_value = client
        mock_notifier.post_publicly = AsyncMock(return_value=True)

        await publish_moderation_decisions()

    assert mock_notifier.post_publicly.await_count == 2
    redis.set.assert_awaited_with(CURSOR_KEY, "7")


async def test_a_failed_group_post_leaves_the_cursor_before_the_group() -> None:
    """A grouped announcement that never landed must be retried whole."""
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
            _event("override_exclude", id=7, track_id=1, reason="not_music"),
            _event("override_exclude", id=8, track_id=2, reason="not_music"),
        ]
        mock_get_client.return_value = client
        mock_notifier.post_publicly = AsyncMock(return_value=False)

        await publish_moderation_decisions()

    # the unpublishable flag at 6 is passed, but the unannounced group is not
    redis.set.assert_awaited_with(CURSOR_KEY, "6")
