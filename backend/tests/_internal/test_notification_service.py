"""tests for the NotificationService.ensure_ready() retry path.

regression: during the 2026-05-17 bsky.social WAF JA4 incident, every
process that started during the WAF window had setup() fail silently and
stayed broken until the next restart — every track upload skipped its
notification, and `notification_sent` was marked true unconditionally so
Jetstream couldn't retry. ensure_ready() runs setup() lazily on each
send attempt (rate-limited by cooldown) so a transient upstream outage
doesn't permanently break the service.
"""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from atproto_client.exceptions import BadRequestError, InvokeTimeoutError
from atproto_client.models.common import XrpcError
from atproto_client.request import Response

from backend._internal.notifications import NotificationService, _origin

NOTIF_SETTINGS = "backend._internal.notifications.settings"


class TestEnsureReady:
    async def test_returns_did_when_already_ready(self) -> None:
        service = NotificationService()
        service.recipient_did = "did:plc:abc"

        assert await service.ensure_ready() == "did:plc:abc"

    async def test_returns_none_when_disabled(self) -> None:
        service = NotificationService()

        with patch(NOTIF_SETTINGS) as mock_settings:
            mock_settings.notify.enabled = False
            assert await service.ensure_ready() is None

    async def test_calls_setup_when_recipient_missing_and_cooldown_elapsed(
        self,
    ) -> None:
        service = NotificationService()
        # last attempt was so long ago the cooldown has elapsed
        service._last_setup_attempt = 0.0

        async def fake_setup() -> None:
            service._last_setup_attempt = 1e9
            service.recipient_did = "did:plc:resolved"

        with (
            patch(NOTIF_SETTINGS) as mock_settings,
            patch.object(service, "setup", side_effect=fake_setup) as mock_setup,
        ):
            mock_settings.notify.enabled = True
            assert await service.ensure_ready() == "did:plc:resolved"
            mock_setup.assert_awaited_once()

    async def test_skips_setup_within_cooldown(self) -> None:
        service = NotificationService()
        # "just attempted setup" — cooldown should suppress the retry
        service._last_setup_attempt = time.monotonic()

        with (
            patch(NOTIF_SETTINGS) as mock_settings,
            patch.object(service, "setup") as mock_setup,
        ):
            mock_settings.notify.enabled = True
            assert await service.ensure_ready() is None
            mock_setup.assert_not_called()

    async def test_returns_none_when_setup_still_fails(self) -> None:
        service = NotificationService()
        service._last_setup_attempt = 0.0

        async def failing_setup() -> None:
            service._last_setup_attempt = 1e9
            # recipient_did stays None — upstream still broken

        with (
            patch(NOTIF_SETTINGS) as mock_settings,
            patch.object(service, "setup", side_effect=failing_setup),
        ):
            mock_settings.notify.enabled = True
            assert await service.ensure_ready() is None


class TestAlertOrigin:
    """operator alerts must say which environment fired them.

    `settings.app.name` is the public-facing name and identical everywhere, so
    a staging reaper DM read "fired on plyr.fm" — the same text production
    sends, which is the first thing an operator needs to distinguish.
    """

    def test_production_is_the_bare_app_name(self) -> None:
        with patch(NOTIF_SETTINGS) as mock_settings:
            mock_settings.app.name = "plyr.fm"
            mock_settings.observability.environment = "production"
            assert _origin() == "plyr.fm"

    @pytest.mark.parametrize("env", ["staging", "local", "development"])
    def test_every_other_environment_is_labelled(self, env: str) -> None:
        with patch(NOTIF_SETTINGS) as mock_settings:
            mock_settings.app.name = "plyr.fm"
            mock_settings.observability.environment = env
            assert _origin() == f"plyr.fm [{env}]"


class TestSessionRecovery:
    """regression: on 2026-09-01 the bot's bsky session was revoked mid-life
    (`ExpiredToken: Token has been revoked`) and every DM failed until the
    next deploy, because `recipient_did` stayed set so `ensure_ready()` never
    re-ran setup(). a dead session must be discarded and re-established on the
    next send, and the send retried once.
    """

    @staticmethod
    def _revoked() -> BadRequestError:
        return BadRequestError(
            Response(
                success=False,
                status_code=400,
                content=XrpcError(
                    error="ExpiredToken", message="Token has been revoked"
                ),
                headers={},
            )
        )

    @staticmethod
    def _dm_client(fail_with: Exception | None) -> MagicMock:
        convo = MagicMock()
        if fail_with is not None:
            convo.get_convo_for_members = AsyncMock(side_effect=fail_with)
        else:
            convo.get_convo_for_members = AsyncMock(
                return_value=MagicMock(convo=MagicMock(id="convo-1"))
            )
        convo.send_message = AsyncMock()
        client = MagicMock()
        client.chat.bsky.convo = convo
        return client

    async def test_revoked_session_relogs_in_and_resends(self) -> None:
        service = NotificationService()
        service.recipient_did = "did:plc:recipient"
        service.dm_client = self._dm_client(self._revoked())
        service._last_setup_attempt = time.monotonic()
        fresh = self._dm_client(None)

        async def relogin() -> None:
            service._last_setup_attempt = time.monotonic()
            service.dm_client = fresh
            service.recipient_did = "did:plc:recipient"

        with (
            patch(NOTIF_SETTINGS) as mock_settings,
            patch.object(service, "setup", side_effect=relogin) as mock_setup,
        ):
            mock_settings.notify.enabled = True
            result = await service._send_dm_to_did("did:plc:recipient", "hi")

        assert result.success
        mock_setup.assert_awaited_once()
        fresh.chat.bsky.convo.send_message.assert_awaited_once()

    async def test_revoked_session_is_discarded_when_relogin_fails(self) -> None:
        service = NotificationService()
        service.recipient_did = "did:plc:recipient"
        service.dm_client = self._dm_client(self._revoked())

        async def still_broken() -> None:
            service._last_setup_attempt = time.monotonic()

        with (
            patch(NOTIF_SETTINGS) as mock_settings,
            patch.object(service, "setup", side_effect=still_broken) as mock_setup,
        ):
            mock_settings.notify.enabled = True
            result = await service._send_dm_to_did("did:plc:recipient", "hi")

        assert not result.success
        assert result.error_type == "session"
        mock_setup.assert_awaited_once()
        assert service.recipient_did is None
        assert service.dm_client is None

    async def test_network_failure_keeps_the_session(self) -> None:
        service = NotificationService()
        service.recipient_did = "did:plc:recipient"
        service.dm_client = self._dm_client(InvokeTimeoutError())

        with patch.object(service, "setup") as mock_setup:
            result = await service._send_dm_to_did("did:plc:recipient", "hi")

        assert not result.success
        assert result.error_type == "network"
        mock_setup.assert_not_called()
        assert service.recipient_did == "did:plc:recipient"
