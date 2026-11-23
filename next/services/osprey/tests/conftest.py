import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import psycopg2
import pytest
from osprey.engine.executor.udf_execution_helpers import UDFHelpers
from osprey.worker.lib.osprey_engine import OspreyEngine, bootstrap_engine_with_helpers
from osprey.worker.lib.singletons import CONFIG

from plyr_osprey import udfs

HERE = Path(__file__).parent
MIGRATIONS = HERE.parents[2] / 'backend' / 'migrations'
TEST_DATABASE_URL = os.environ.get('TEST_DATABASE_URL')

# the plugin reads these when the worker boots; tests use the same path
os.environ.setdefault('OSPREY_RULES_PATH', str(HERE.parent / 'rules'))
os.environ.setdefault('DATABASE_URL', TEST_DATABASE_URL or 'postgresql://unused@127.0.0.1:1/unused')
os.environ.setdefault('OSPREY_DRAIN_ONCE', 'true')
CONFIG.instance().configure_from_env()


class FakeFingerprinter:
    def __init__(self) -> None:
        self.by_url: dict[str, list[dict[str, Any]]] = {}
        self.failing: set[str] = set()
        self.scanned: list[str] = []

    def matches(self, audio_url: str) -> list[dict[str, Any]]:
        self.scanned.append(audio_url)
        if audio_url in self.failing:
            raise RuntimeError('scan failed')
        return self.by_url.get(audio_url, [])


@pytest.fixture(scope='session')
def engine() -> tuple[OspreyEngine, UDFHelpers]:
    return bootstrap_engine_with_helpers()


@pytest.fixture()
def fingerprinter(monkeypatch: pytest.MonkeyPatch) -> FakeFingerprinter:
    fake = FakeFingerprinter()
    monkeypatch.setattr(udfs, 'fingerprinter', fake)
    return fake


# the slice of next's schema the worker touches; the moderation tables come
# from the real migrations
INDEX_SCHEMA = """
DROP SCHEMA IF EXISTS plyr_index CASCADE;
DROP SCHEMA IF EXISTS plyr_moderation CASCADE;
CREATE SCHEMA plyr_index;
CREATE TABLE plyr_index.track_records (
    record_uri TEXT PRIMARY KEY, record_cid TEXT, owner_did TEXT NOT NULL, collection TEXT NOT NULL,
    title TEXT, audio_url TEXT, audio_blob_cid TEXT, deleted BOOLEAN NOT NULL DEFAULT false,
    indexed_at_us BIGINT NOT NULL
);
CREATE TABLE plyr_index.track_delivery_origins (
    record_uri TEXT NOT NULL, service TEXT NOT NULL, record_cid TEXT NOT NULL, origin_url TEXT NOT NULL,
    media_type TEXT NOT NULL, artifact_cid TEXT NOT NULL, verification TEXT NOT NULL,
    observed_at_us BIGINT NOT NULL, PRIMARY KEY (record_uri, service)
);
CREATE TABLE plyr_index.actor_identities (did TEXT PRIMARY KEY, handle TEXT NOT NULL, display_name TEXT NOT NULL);
CREATE TABLE plyr_index.track_policies (
    record_uri TEXT PRIMARY KEY, operator_labels JSONB NOT NULL DEFAULT '[]', moderation_decision TEXT,
    moderation_write_source TEXT, moderation_observed_at_us BIGINT
);
"""


@pytest.fixture()
def db() -> Iterator[psycopg2.extensions.connection]:
    if not TEST_DATABASE_URL:
        pytest.skip('TEST_DATABASE_URL not set')
    conn = psycopg2.connect(TEST_DATABASE_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(INDEX_SCHEMA)
        for name in ('0048_add_moderation_log.sql', '0050_add_moderation_rules_state.sql'):
            cur.execute((MIGRATIONS / name).read_text())
    yield conn
    conn.close()
