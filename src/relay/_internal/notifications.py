"""notification service for relay events."""

import logging
from datetime import UTC, datetime, timedelta

from atproto import AsyncClient, models
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from relay.config import settings
from relay.models import Track
from relay.utilities.database import db_session

logger = logging.getLogger(__name__)


class NotificationService:
    """service for sending notifications about relay events."""

    def __init__(self):
        self.last_check: datetime | None = None
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

    async def check_new_tracks(self):
        """check for new tracks and send notifications."""
        if not settings.notify.enabled:
            return

        if not self.recipient_did or not self.client:
            return

        async with db_session() as db:
            try:
                # determine time window for checking
                if self.last_check is None:
                    # first run: check last 5 minutes
                    check_since = datetime.now(UTC) - timedelta(minutes=5)
                else:
                    check_since = self.last_check

                # query for new tracks with artist eagerly loaded
                stmt = (
                    select(Track)
                    .options(selectinload(Track.artist))
                    .where(Track.created_at > check_since)
                )
                result = await db.execute(stmt)
                new_tracks = result.scalars().all()

                if new_tracks:
                    logger.info(f"found {len(new_tracks)} new tracks")
                    for track in new_tracks:
                        await self.send_track_notification(track)
                else:
                    logger.debug("no new tracks found")

                self.last_check = datetime.now(UTC)

            except Exception as e:
                logger.exception(f"error checking new tracks: {e}")

    async def send_track_notification(self, track: Track):
        """send notification about a new track."""
        if not self.dm_client or not self.recipient_did:
            logger.warning(
                "dm client not authenticated or recipient not set, skipping notification"
            )
            return

        try:
            # create shortcut to convo methods
            dm = self.dm_client.chat.bsky.convo

            # get or create conversation with the target user
            convo_response = await dm.get_convo_for_members(
                models.ChatBskyConvoGetConvoForMembers.Params(
                    members=[self.recipient_did]
                )
            )

            if not convo_response.convo or not convo_response.convo.id:
                raise ValueError("failed to get conversation ID")

            convo_id = convo_response.convo.id

            # format the message with rich information
            artist_handle = track.artist.handle

            # only include link if we have a production URL (not localhost)
            track_url = None
            if settings.frontend_url and "localhost" not in settings.frontend_url:
                track_url = f"{settings.frontend_url}/track/{track.id}"

            if track_url:
                message_text: str = (
                    f"🎵 new track on relay!\n\n"
                    f"'{track.title}' by @{artist_handle}\n\n"
                    f"listen: {track_url}\n"
                    f"uploaded: {track.created_at.strftime('%b %d at %H:%M UTC')}"
                )
            else:
                # dev environment - no link
                message_text: str = (
                    f"🎵 new track on relay!\n\n"
                    f"'{track.title}' by @{artist_handle}\n"
                    f"uploaded: {track.created_at.strftime('%b %d at %H:%M UTC')}"
                )

            # send the DM
            await dm.send_message(
                models.ChatBskyConvoSendMessage.Data(
                    convo_id=convo_id,
                    message=models.ChatBskyConvoDefs.MessageInput(text=message_text),
                )
            )

            logger.info(f"sent notification for track {track.id} to {convo_id}")

        except Exception:
            logger.exception(f"error sending notification for track {track.id}")

    async def shutdown(self):
        """cleanup resources."""
        logger.info("shutting down notification service")


# global instance
notification_service = NotificationService()
