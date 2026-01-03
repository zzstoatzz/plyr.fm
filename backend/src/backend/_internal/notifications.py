"""notification service for relay events."""

import logging
from dataclasses import dataclass

import logfire
from atproto import AsyncClient, models

from backend.config import settings
from backend.models import Track

logger = logging.getLogger(__name__)


@dataclass
class NotificationResult:
    """result of a notification attempt."""

    success: bool
    recipient_did: str
    error: str | None = None
    error_type: str | None = None  # "dm_blocked", "network", "auth", "unknown"


class NotificationService:
    """service for sending notifications about relay events."""

    def __init__(self):
        self.client: AsyncClient | None = None
        self.dm_client: AsyncClient | None = None
        self.recipient_did: str | None = None

    async def setup(self):
        """initialize the notification service."""
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
            logger.debug(
                f"resolved {settings.notify.recipient_handle} to {self.recipient_did}"
            )

        except Exception:
            logger.exception(
                "failed to authenticate notification bot or resolve recipient"
            )
            self.client = None
            self.dm_client = None
            self.recipient_did = None

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

    async def send_copyright_notification(
        self,
        track_id: int,
        track_title: str,
        artist_did: str,
        artist_handle: str,
        highest_score: int,
        matches: list[dict],
    ) -> tuple[NotificationResult | None, NotificationResult | None]:
        """send notification about a copyright flag to both artist and admin.

        returns (artist_result, admin_result) tuple with details of each attempt.
        """
        with logfire.span(
            "copyright_notification",
            track_id=track_id,
            track_title=track_title,
            artist_did=artist_did,
            artist_handle=artist_handle,
            highest_score=highest_score,
            match_count=len(matches),
        ) as span:
            if not self.dm_client:
                logfire.warn("dm client not authenticated, skipping notification")
                return None, None

            # format match info
            match_count = len(matches)
            primary_match = None
            if matches:
                m = matches[0]
                primary_match = (
                    f"{m.get('title', 'Unknown')} by {m.get('artist', 'Unknown')}"
                )

            # build track URL if available
            track_url = None
            frontend_url = settings.frontend.url
            if frontend_url and "localhost" not in frontend_url:
                track_url = f"{frontend_url}/track/{track_id}"

            # message for the artist (uploader)
            artist_message = (
                f"⚠️ copyright notice for your track on {settings.app.name}\n\n"
                f"track: '{track_title}'\n"
                f"match confidence: {highest_score}%\n"
            )
            if primary_match:
                artist_message += f"potential match: {primary_match}\n"
            artist_message += (
                "\nif you believe this is an error, please reply to this message. "
                "otherwise, the track may be removed after review."
            )

            # message for admin
            admin_message = (
                f"🚨 copyright flag on {settings.app.name}\n\n"
                f"track: '{track_title}'\n"
                f"artist: @{artist_handle}\n"
                f"score: {highest_score}%\n"
                f"matches: {match_count}\n"
            )
            if primary_match:
                admin_message += f"primary: {primary_match}\n"
            if track_url:
                admin_message += f"\n{track_url}"

            # send to artist
            artist_result = await self._send_dm_to_did(artist_did, artist_message)
            span.set_attribute("artist_success", artist_result.success)
            if not artist_result.success:
                span.set_attribute("artist_error_type", artist_result.error_type)
                logfire.warn(
                    "failed to notify artist",
                    artist_handle=artist_handle,
                    error_type=artist_result.error_type,
                    error=artist_result.error,
                )

            # send to admin
            admin_result = None
            if self.recipient_did:
                admin_result = await self._send_dm_to_did(
                    self.recipient_did, admin_message
                )
                span.set_attribute("admin_success", admin_result.success)
                if not admin_result.success:
                    span.set_attribute("admin_error_type", admin_result.error_type)
                    logfire.warn(
                        "failed to notify admin",
                        error_type=admin_result.error_type,
                        error=admin_result.error,
                    )

            # summary
            any_success = artist_result.success or (
                admin_result and admin_result.success
            )
            span.set_attribute("any_success", any_success)

            if artist_result.success:
                logfire.info(
                    "sent copyright notification to artist",
                    artist_handle=artist_handle,
                    track_id=track_id,
                )
            if admin_result and admin_result.success:
                logfire.info(
                    "sent copyright notification to admin",
                    track_id=track_id,
                )

            return artist_result, admin_result

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
        if not self.recipient_did:
            logger.warning("recipient not set, skipping notification")
            return None

        categories_str = ", ".join(categories) if categories else "unspecified"
        message_text = (
            f"🚨 image flagged on {settings.app.name}\n\n"
            f"context: {context}\n"
            f"image_id: {image_id}\n"
            f"severity: {severity}\n"
            f"categories: {categories_str}"
        )

        result = await self._send_dm_to_did(self.recipient_did, message_text)
        if result.success:
            logger.info(f"sent image flag notification for {image_id}")
        return result

    async def send_track_notification(self, track: Track) -> NotificationResult | None:
        """send notification about a new track."""
        if not self.recipient_did:
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
                f"🎵 new track on {settings.app.name}!\n\n"
                f"'{track.title}' by @{artist_handle}\n\n"
                f"listen: {track_url}\n"
                f"uploaded: {track.created_at.strftime('%b %d at %H:%M UTC')}"
            )
        else:
            # dev environment - no link
            message_text = (
                f"🎵 new track on {settings.app.name}!\n\n"
                f"'{track.title}' by @{artist_handle}\n"
                f"uploaded: {track.created_at.strftime('%b %d at %H:%M UTC')}"
            )

        result = await self._send_dm_to_did(self.recipient_did, message_text)
        if result.success:
            logger.info(f"sent notification for track {track.id}")
        return result

    async def shutdown(self):
        """cleanup resources."""
        logger.info("shutting down notification service")


# global instance
notification_service = NotificationService()
