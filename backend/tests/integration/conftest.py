"""fixtures for integration tests.

these tests run against a real staging environment and require:
- PLYR_TEST_TOKEN_1: dev token for primary test user
- PLYR_TEST_TOKEN_2: dev token for secondary test user (optional)
- PLYR_TEST_TOKEN_3: dev token for tertiary test user (optional)
- PLYR_API_URL: API base URL (defaults to https://api-stg.plyr.fm)
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator, Generator
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from .utils.audio import save_drone

if TYPE_CHECKING:
    from plyrfm import AsyncPlyrClient


@dataclass
class IntegrationSettings:
    """settings for integration tests."""

    api_url: str
    token_1: str | None
    token_2: str | None
    token_3: str | None

    @property
    def has_primary_token(self) -> bool:
        """check if primary token is configured."""
        return bool(self.token_1)

    @property
    def has_multi_user(self) -> bool:
        """check if multiple users are configured."""
        return bool(self.token_1 and self.token_2)

    @property
    def has_three_users(self) -> bool:
        """check if all three users are configured."""
        return bool(self.token_1 and self.token_2 and self.token_3)


@pytest.fixture(scope="session")
def integration_settings() -> IntegrationSettings:
    """load integration test settings from environment."""
    return IntegrationSettings(
        api_url=os.getenv("PLYR_API_URL", "https://api-stg.plyr.fm"),
        token_1=os.getenv("PLYR_TEST_TOKEN_1"),
        token_2=os.getenv("PLYR_TEST_TOKEN_2"),
        token_3=os.getenv("PLYR_TEST_TOKEN_3"),
    )


def _skip_if_no_token(settings: IntegrationSettings) -> None:
    """skip test if no primary token is configured."""
    if not settings.has_primary_token:
        pytest.skip("PLYR_TEST_TOKEN_1 not set")


def _skip_if_no_multi_user(settings: IntegrationSettings) -> None:
    """skip test if multi-user tokens are not configured."""
    if not settings.has_multi_user:
        pytest.skip("PLYR_TEST_TOKEN_1 and PLYR_TEST_TOKEN_2 required")


@pytest.fixture
async def user1_client(
    integration_settings: IntegrationSettings,
) -> AsyncGenerator[AsyncPlyrClient, None]:
    """async client authenticated as test user 1."""
    _skip_if_no_token(integration_settings)

    from plyrfm import AsyncPlyrClient

    async with AsyncPlyrClient(
        token=integration_settings.token_1,
        api_url=integration_settings.api_url,
        timeout=120.0,
    ) as client:
        yield client


@pytest.fixture
async def user2_client(
    integration_settings: IntegrationSettings,
) -> AsyncGenerator[AsyncPlyrClient, None]:
    """async client authenticated as test user 2."""
    _skip_if_no_multi_user(integration_settings)

    from plyrfm import AsyncPlyrClient

    async with AsyncPlyrClient(
        token=integration_settings.token_2,
        api_url=integration_settings.api_url,
        timeout=120.0,
    ) as client:
        yield client


@pytest.fixture
async def user3_client(
    integration_settings: IntegrationSettings,
) -> AsyncGenerator[AsyncPlyrClient, None]:
    """async client authenticated as test user 3."""
    if not integration_settings.has_three_users:
        pytest.skip("PLYR_TEST_TOKEN_3 required")

    from plyrfm import AsyncPlyrClient

    async with AsyncPlyrClient(
        token=integration_settings.token_3,
        api_url=integration_settings.api_url,
        timeout=120.0,
    ) as client:
        yield client


@pytest.fixture
def drone_a4(tmp_path: Path) -> Generator[Path, None, None]:
    """generate a 2-second A4 drone (440Hz)."""
    path = tmp_path / "drone_a4.wav"
    save_drone(path, "A4", duration_sec=2.0)
    yield path


@pytest.fixture
def drone_e4(tmp_path: Path) -> Generator[Path, None, None]:
    """generate a 2-second E4 drone (330Hz)."""
    path = tmp_path / "drone_e4.wav"
    save_drone(path, "E4", duration_sec=2.0)
    yield path


@pytest.fixture
def drone_c4(tmp_path: Path) -> Generator[Path, None, None]:
    """generate a 2-second C4 drone (262Hz)."""
    path = tmp_path / "drone_c4.wav"
    save_drone(path, "C4", duration_sec=2.0)
    yield path
