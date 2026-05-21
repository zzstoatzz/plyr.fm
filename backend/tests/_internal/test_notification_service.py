"""tests for the NotificationService.ensure_ready() retry path.

regression: during the 2026-05-17 bsky.social WAF JA4 incident, every
process that started during the WAF window had setup() fail silently and
stayed broken until the next restart — every track upload skipped its
notification, and `notification_sent` was marked true unconditionally so
Jetstream couldn't retry. ensure_ready() runs setup() lazily on each
send attempt (rate-limited by cooldown) so a transient upstream outage
doesn't permanently break the service.
"""

from unittest.mock import patch

from backend._internal.notifications import NotificationService

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
        import time

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
