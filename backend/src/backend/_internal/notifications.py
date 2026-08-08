"""notification service for relay events."""

import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass

import logfire
from atproto import AsyncClient, client_utils, models

from backend._internal.transparency import Segment
from backend.config import settings
from backend.models import Track

logger = logging.getLogger(__name__)


def _origin() -> str:
    """the app name, qualified by environment everywhere but production.

    `settings.app.name` is the public-facing name and is identical in every
    environment, so a reaper DM fired by staging read "fired on plyr.fm" --
    indistinguishable from the same alert fired by production, which is the
    one thing an operator needs to know first.
    """
    if (env := settings.observability.environment) == "production":
        return settings.app.name
    return f"{settings.app.name} [{env}]"


@dataclass
class NotificationResult:
    """result of a notification attempt."""

    success: bool
    recipient_did: str
    error: str | None = None
    error_type: str | None = None  # "dm_blocked", "network", "auth", "unknown"


class NotificationService:
    """service for sending notifications about relay events."""

    # if setup fails (e.g. bsky.social returning 403 during a WAF incident),
    # retry no more than once per this many seconds. each track upload would
    # otherwise re-attempt the login and hammer the upstream during outages.
    _SETUP_RETRY_COOLDOWN_S = 60.0

    def __init__(self):
        self.client: AsyncClient | None = None
        self.dm_client: AsyncClient | None = None
        self.recipient_did: str | None = None
        self._last_setup_attempt: float = 0.0

    async def setup(self):
        """initialize the notification service. safe to call repeatedly."""
        self._last_setup_attempt = time.monotonic()

        if not settings.notify.enabled:
            logger.info("notification service disabled")
            return

        if not all(
            [
                settings.notify.recipient_handle,
                settings.notify.bot.handle,
                settings.notify.bot.password,
            ]
        ):
            logger.warning(
                "notification service enabled but missing required config: "
                "recipient_handle, bot.handle, bot.password"
            )
            return

        # authenticate the bot
        try:
            self.client = AsyncClient()
            await self.client.login(
                settings.notify.bot.handle,
                settings.notify.bot.password,
            )
            logger.info(
                f"notification bot authenticated as {settings.notify.bot.handle}"
            )

            # create chat-proxied client for DMs
            self.dm_client = self.client.with_bsky_chat_proxy()

            # resolve recipient handle to DID
            profile = await self.client.app.bsky.actor.get_profile(
                {"actor": settings.notify.recipient_handle}
            )
            self.recipient_did = profile.did
            logger.info(
                f"resolved {settings.notify.recipient_handle} to {self.recipient_did}"
            )

        except Exception:
            logger.exception(
                "failed to authenticate notification bot or resolve recipient"
            )
            self.client = None
            self.dm_client = None
            self.recipient_did = None

    async def ensure_ready(self) -> str | None:
        """return the resolved recipient DID if the service is ready, else None.

        if state is broken (recipient_did missing) and notifications are
        enabled, attempt to re-run setup() to recover. retries are rate-
        limited by _SETUP_RETRY_COOLDOWN_S so a sustained upstream outage
        doesn't get amplified into every-upload login attempts.
        """
        if self.recipient_did is not None:
            return self.recipient_did
        if not settings.notify.enabled:
            return None
        if (time.monotonic() - self._last_setup_attempt) < self._SETUP_RETRY_COOLDOWN_S:
            return None
        await self.setup()
        return self.recipient_did

    async def _send_dm_to_did(
        self, recipient_did: str, message_text: str
    ) -> NotificationResult:
        """send a DM to a specific DID.

        returns NotificationResult with success status and error details.
        """
        if not self.dm_client:
            return NotificationResult(
                success=False,
                recipient_did=recipient_did,
                error="dm client not authenticated",
                error_type="auth",
            )

        with logfire.span(
            "send_dm",
            recipient_did=recipient_did,
            message_length=len(message_text),
        ) as span:
            try:
                dm = self.dm_client.chat.bsky.convo

                convo_response = await dm.get_convo_for_members(
                    models.ChatBskyConvoGetConvoForMembers.Params(
                        members=[recipient_did]
                    )
                )

                if not convo_response.convo or not convo_response.convo.id:
                    span.set_attribute("error_type", "no_convo")
                    return NotificationResult(
                        success=False,
                        recipient_did=recipient_did,
                        error="failed to get conversation ID - user may have DMs disabled",
                        error_type="dm_blocked",
                    )

                await dm.send_message(
                    models.ChatBskyConvoSendMessage.Data(
                        convo_id=convo_response.convo.id,
                        message=models.ChatBskyConvoDefs.MessageInput(
                            text=message_text
                        ),
                    )
                )

                span.set_attribute("success", True)
                return NotificationResult(success=True, recipient_did=recipient_did)

            except Exception as e:
                error_str = str(e)
                error_type = "unknown"

                # try to categorize the error
                if "blocked" in error_str.lower() or "not allowed" in error_str.lower():
                    error_type = "dm_blocked"
                elif "timeout" in error_str.lower() or "connect" in error_str.lower():
                    error_type = "network"
                elif "auth" in error_str.lower() or "401" in error_str:
                    error_type = "auth"

                span.set_attribute("error_type", error_type)
                span.set_attribute("error", error_str)
                logger.exception(f"error sending DM to {recipient_did}")

                return NotificationResult(
                    success=False,
                    recipient_did=recipient_did,
                    error=error_str,
                    error_type=error_type,
                )

    async def post_publicly(self, segments: Sequence[Segment]) -> bool:
        """Post from the moderation account's own timeline.

        Distinct from every other method here, which sends a DM to one
        recipient. This is outward-facing: it reaches anyone, so the caller is
        responsible for having decided the content is publishable (see
        `_internal/transparency`).

        Takes segments rather than a string because Bluesky does not infer
        links from text. A URL only renders as a link if the record carries a
        matching `facet` -- a byte range into the UTF-8 encoding of the text.
        TextBuilder tracks those offsets as it appends, which is why the text
        is assembled here rather than passed in pre-joined.

        Returns whether the post was created, so a caller walking a cursor can
        stop rather than skip past an announcement that never happened.
        """
        if await self.ensure_ready() is None or self.client is None:
            logger.warning("cannot post publicly: notification bot not ready")
            return False

        builder = client_utils.TextBuilder()
        for segment in segments:
            if segment.link:
                builder.link(segment.text, segment.link)
            else:
                builder.text(segment.text)

        try:
            await self.client.send_post(builder)
            logfire.info(
                "transparency post published",
                chars=len(builder.build_text()),
                facets=len(builder.build_facets()),
            )
            return True
        except Exception:
            logger.exception("failed to publish transparency post")
            return False

    async def send_copyright_flag_notification(
        self,
        track_id: int,
        track_title: str,
        artist_handle: str,
        matches: list[dict],
    ) -> NotificationResult | None:
        """send admin-only notification about a copyright flag."""
        recipient_did = await self.ensure_ready()
        if recipient_did is None:
            logger.warning("recipient not set, skipping notification")
            return None

        primary_match = None
        if matches:
            m = matches[0]
            primary_match = (
                f"{m.get('title', 'Unknown')} by {m.get('artist', 'Unknown')}"
            )

        track_url = None
        frontend_url = settings.frontend.url
        if frontend_url and "localhost" not in frontend_url:
            track_url = f"{frontend_url}/track/{track_id}"

        message_text = (
            f"copyright flag on {_origin()}\n\n"
            f"track: '{track_title}'\n"
            f"artist: @{artist_handle}\n"
            f"matches: {len(matches)}\n"
        )
        if primary_match:
            message_text += f"primary: {primary_match}\n"
        if track_url:
            message_text += f"\n{track_url}"

        result = await self._send_dm_to_did(recipient_did, message_text)
        if result.success:
            logger.info(f"sent copyright flag notification for track {track_id}")
        return result

    async def send_image_flag_notification(
        self,
        image_id: str,
        severity: str,
        categories: list[str],
        context: str,
    ) -> NotificationResult | None:
        """send notification about a flagged image.

        args:
            image_id: R2 storage ID of the flagged image
            severity: severity level (low, medium, high)
            categories: list of violated policy categories
            context: where the image was uploaded (e.g., "track cover", "album cover")
        """
        recipient_did = await self.ensure_ready()
        if recipient_did is None:
            logger.warning("recipient not set, skipping notification")
            return None

        categories_str = ", ".join(categories) if categories else "unspecified"
        message_text = (
            f"🚨 image flagged on {_origin()}\n\n"
            f"context: {context}\n"
            f"image_id: {image_id}\n"
            f"severity: {severity}\n"
            f"categories: {categories_str}"
        )

        result = await self._send_dm_to_did(recipient_did, message_text)
        if result.success:
            logger.info(f"sent image flag notification for {image_id}")
        return result

    async def send_user_report_notification(
        self,
        report_id: int,
        reporter_handle: str | None,
        target_type: str,
        target_name: str | None,
        target_url: str | None,
        reason: str,
        description: str | None,
    ) -> NotificationResult | None:
        """send notification about a new user report."""
        recipient_did = await self.ensure_ready()
        if recipient_did is None:
            logger.warning("recipient not set, skipping notification")
            return None

        # build target display
        target_display = target_name or f"[{target_type}]"

        # build reporter display
        reporter_display = f"@{reporter_handle}" if reporter_handle else "anonymous"

        # build URL if available
        target_link = ""
        frontend_url = settings.frontend.url
        if target_url and frontend_url and "localhost" not in frontend_url:
            target_link = f"\n{frontend_url}{target_url}"

        message_text = (
            f"📋 new user report on {_origin()}\n\n"
            f"from: {reporter_display}\n"
            f"target: {target_display}{target_link}\n"
            f"reason: {reason}\n"
        )
        if description:
            # truncate long descriptions
            desc = description[:200] + "..." if len(description) > 200 else description
            message_text += f'\n"{desc}"'

        result = await self._send_dm_to_did(recipient_did, message_text)
        if result.success:
            logger.info(f"sent user report notification for report {report_id}")
        return result

    async def send_track_notification(self, track: Track) -> NotificationResult | None:
        """send notification about a new track."""
        recipient_did = await self.ensure_ready()
        if recipient_did is None:
            logger.warning("recipient not set, skipping notification")
            return None

        artist_handle = track.artist.handle

        # only include link if we have a non-localhost frontend URL
        track_url = None
        frontend_url = settings.frontend.url
        if frontend_url and "localhost" not in frontend_url:
            track_url = f"{frontend_url}/track/{track.id}"

        if track_url:
            message_text = (
                f"🎵 new track on {_origin()}!\n\n"
                f"'{track.title}' by @{artist_handle}\n\n"
                f"listen: {track_url}\n"
                f"uploaded: {track.created_at.strftime('%b %d at %H:%M UTC')}"
            )
        else:
            # dev environment - no link
            message_text = (
                f"🎵 new track on {_origin()}!\n\n"
                f"'{track.title}' by @{artist_handle}\n"
                f"uploaded: {track.created_at.strftime('%b %d at %H:%M UTC')}"
            )

        result = await self._send_dm_to_did(recipient_did, message_text)
        if result.success:
            logger.info(f"sent notification for track {track.id}")
        return result

    async def send_reaper_notification(
        self,
        reaped_count: int,
        affected_handles: list[str],
        threshold_minutes: int,
        job_ids: list[str],
    ) -> NotificationResult | None:
        """admin-only DM summarizing a stuck-upload reaper run.

        called once per reap (not per stuck job) to avoid DM spam during a
        system-wide outage. the affected handles + job IDs let the
        on-call (you) jump straight to logfire / DB to investigate without
        another query.
        """
        recipient_did = await self.ensure_ready()
        if recipient_did is None:
            logger.warning("recipient not set, skipping reaper notification")
            return None

        handles_str = (
            ", ".join(f"@{h}" for h in sorted(affected_handles))
            if affected_handles
            else "(unresolved)"
        )
        # show at most 3 job ids inline; the rest live in logfire under the
        # reap_stuck_uploads span. truncation keeps the DM short.
        if len(job_ids) <= 3:
            ids_str = ", ".join(job_ids)
        else:
            ids_str = ", ".join(job_ids[:3]) + f" (+{len(job_ids) - 3} more)"

        message_text = (
            f"⚠️ stuck-upload reaper fired on {_origin()}\n\n"
            f"reaped {reaped_count} upload job"
            f"{'s' if reaped_count != 1 else ''} stuck >{threshold_minutes} min\n"
            f"affected: {handles_str}\n"
            f"job ids: {ids_str}\n\n"
            f"runbook: docs/internal/retrospectives/2026-05-10-worker-oom-loop-streaming.md"
        )

        result = await self._send_dm_to_did(recipient_did, message_text)
        if result.success:
            logger.info(
                "sent reaper notification (reaped=%d, affected=%d)",
                reaped_count,
                len(affected_handles),
            )
        return result

    async def shutdown(self):
        """cleanup resources."""
        logger.info("shutting down notification service")


# global instance
notification_service = NotificationService()
