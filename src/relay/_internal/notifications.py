"""notification service for relay events."""

import logging
from datetime import UTC, datetime, timedelta

from atproto import AsyncClient
from atproto_client.models.chat.bsky.convo.defs import MessageInput
from atproto_client.models.chat.bsky.convo.send_message import DataDict
from sqlalchemy import select

from relay.config import settings
from relay.models import Track
from relay.utilities.database import db_session

logger = logging.getLogger(__name__)


class NotificationService:
    """service for sending notifications about relay events."""

    def __init__(self):
        self.last_check: datetime | None = None
        self.client: AsyncClient | None = None
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

                # query for new tracks
                stmt = select(Track).where(Track.created_at > check_since)
                result = await db.execute(stmt)
                new_tracks = result.scalars().all()

                if new_tracks:
                    logger.info(f"found {len(new_tracks)} new tracks")
                    for track in new_tracks:
                        await self._send_track_notification(track)
                else:
                    logger.debug("no new tracks found")

                self.last_check = datetime.now(UTC)

            except Exception as e:
                logger.exception(f"error checking new tracks: {e}")

    async def _send_track_notification(self, track: Track):
        """send notification about a new track."""
        if not self.client or not self.recipient_did:
            logger.warning(
                "bot client not authenticated or recipient not set, skipping notification"
            )
            return

        try:
            # get or create conversation with the target user
            convo_response = await self.client.chat.bsky.convo.get_convo_for_members(
                params={"members": [self.recipient_did]}
            )

            if not convo_response.convo or not convo_response.convo.id:
                raise ValueError("failed to get conversation ID")

            convo_id = convo_response.convo.id

            # format the message
            message_text: str = (
                f"🎵 new track uploaded!\n\n"
                f"title: {track.title}\n"
                f"artist: {track.artist_did}\n"
                f"uploaded: {track.created_at.strftime('%Y-%m-%d %H:%M UTC')}"
            )

            # send the DM
            await self.client.chat.bsky.convo.send_message(
                data=DataDict(
                    convo_id=convo_id, message=MessageInput(text=message_text)
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
