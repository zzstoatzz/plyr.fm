"""Osprey's entity labels (its memory across events, e.g. an account rules have
seen before), kept in next's Postgres. Osprey requires a labels service; these
are internal to the rules and are not the signed atproto labels next publishes.
"""

import json
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any

import psycopg2
import psycopg2.extensions
from osprey.engine.language_types.entities import EntityT
from osprey.worker.lib.osprey_shared.labels import EntityLabels
from osprey.worker.lib.storage.labels import LabelsServiceBase

from plyr_osprey.store import plain_dsn

READ = 'SELECT labels FROM plyr_moderation.osprey_entity_labels WHERE entity_key = %s'
LOCK = READ + ' FOR UPDATE'
WRITE = """
INSERT INTO plyr_moderation.osprey_entity_labels (entity_key, labels) VALUES (%s, %s)
ON CONFLICT (entity_key) DO UPDATE SET labels = EXCLUDED.labels, updated_at = clock_timestamp()
"""


class PostgresEntityLabels(LabelsServiceBase):
    def __init__(self, dsn: str) -> None:
        super().__init__()
        self._dsn = plain_dsn(dsn)
        self._conn: psycopg2.extensions.connection | None = None

    def _connection(self) -> psycopg2.extensions.connection:
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(self._dsn, application_name='plyr-next-osprey-labels')
        return self._conn

    def read_labels(self, entity: EntityT[Any]) -> EntityLabels:
        conn = self._connection()
        with conn, conn.cursor() as cur:
            cur.execute(READ, (str(entity),))
            row = cur.fetchone()
        return EntityLabels.deserialize(row[0]) if row else EntityLabels()

    @contextmanager
    def read_modify_write_labels_atomically(self, entity: EntityT[Any]) -> Generator[EntityLabels, None, None]:
        conn = self._connection()
        with conn, conn.cursor() as cur:
            cur.execute(LOCK, (str(entity),))
            row = cur.fetchone()
            labels = EntityLabels.deserialize(row[0]) if row else EntityLabels()
            yield labels
            cur.execute(WRITE, (str(entity), json.dumps(labels.serialize())))
