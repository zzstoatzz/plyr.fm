"""the suite must never create, truncate, or clone on a non-local database.

conftest derives its base URL from `settings.database.url`, which loads
`backend/.env`. a developer pointing that at neon for local work would
otherwise have `create_all` + `_truncate_tables` + `CREATE DATABASE` run
against a real cloud database, while the compose stack sat unused.
"""

import re

import pytest

from tests.conftest import _require_local_test_database

LOCAL_URLS = (
    "postgresql+asyncpg://relay_test:relay_test@localhost:5433/relay_test",
    "postgresql+asyncpg://relay_test:relay_test@127.0.0.1:5433/relay_test",
    "postgresql+psycopg://localhost/plyr",
)

REMOTE_URLS = (
    "postgresql+psycopg://user:pw@ep-flat-haze-aefjvcba-pooler.c-2.us-east-2.aws.neon.tech/neondb",
    "postgresql+asyncpg://user:pw@db.internal.example.com:5432/plyr",
)


@pytest.mark.parametrize("url", LOCAL_URLS)
def test_local_hosts_are_allowed(url: str) -> None:
    _require_local_test_database(url)


@pytest.mark.parametrize("url", REMOTE_URLS)
def test_remote_hosts_are_refused(url: str) -> None:
    with pytest.raises(pytest.UsageError, match="refusing to run tests"):
        _require_local_test_database(url)


@pytest.mark.parametrize("url", REMOTE_URLS)
def test_remote_hosts_allowed_with_explicit_opt_in(
    url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ALLOW_REMOTE_TEST_DATABASE", "1")
    _require_local_test_database(url)


def test_the_refusal_names_the_offending_host() -> None:
    """a guard that fires without saying what it saw sends you reading conftest."""
    with pytest.raises(pytest.UsageError, match=re.escape("neon.tech")):
        _require_local_test_database(REMOTE_URLS[0])
