"""Test package configuration."""

import os

# Ensure tests run against local, isolated services regardless of .env defaults.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://relay_test:relay_test@localhost:5433/relay_test",
)
os.environ.setdefault("FRONTEND_URL", "http://localhost:5173")
os.environ.setdefault("LOGFIRE_ENABLED", "false")
os.environ.setdefault("NOTIFY_ENABLED", "false")

# Re-initialize settings after applying overrides so downstream imports
# observe the test configuration.
import backend.config as relay_config

relay_config.settings = relay_config.Settings()
