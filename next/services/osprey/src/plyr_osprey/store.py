"""next's Postgres, as the worker sees it: indexed tracks in, review flags out.

the cursor walks plyr_index.track_records in (indexed_at_us, record_uri)
order, so an edited track comes round again. the flags for a track, the scan
record and the cursor move in one transaction, so a crash re-runs a track
rather than skipping it. a track that keeps failing is passed over after
MAX_ATTEMPTS runs, so one bad file can't stall the queue.
"""

import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import psycopg2
import psycopg2.extensions

MAX_ATTEMPTS = 3
CURSOR_NAME = 'tracks'

SELECT_CURSOR = 'SELECT indexed_at_us, record_uri FROM plyr_moderation.rule_cursors WHERE name = %s'

START_CURSOR = """
INSERT INTO plyr_moderation.rule_cursors (name, indexed_at_us, record_uri)
VALUES (%s, %s, '') ON CONFLICT (name) DO NOTHING
"""

SELECT_TRACKS = """
SELECT t.record_uri, t.record_cid, t.owner_did, t.title, t.audio_url, t.indexed_at_us,
       coalesce(a.handle, ''), coalesce(a.display_name, ''),
       EXISTS (SELECT 1 FROM plyr_moderation.scans s
               WHERE s.record_uri = t.record_uri AND s.audio_url = t.audio_url)
FROM plyr_index.track_records t
LEFT JOIN plyr_index.actor_identities a ON a.did = t.owner_did
WHERE NOT t.deleted
  AND t.collection = %s
  AND (t.indexed_at_us, t.record_uri) > (%s, %s)
ORDER BY t.indexed_at_us, t.record_uri
LIMIT %s
"""

INSERT_FLAG = """
INSERT INTO plyr_moderation.events (subject_uri, action, actor, reason)
VALUES (%s, %s, %s, %s)
"""

INSERT_SCAN = """
INSERT INTO plyr_moderation.scans (record_uri, record_cid, audio_url, recordings_found)
VALUES (%s, %s, %s, %s)
ON CONFLICT (record_uri, audio_url) DO NOTHING
"""

ADVANCE = """
UPDATE plyr_moderation.rule_cursors
SET indexed_at_us = %s, record_uri = %s, attempts = 0, updated_at = clock_timestamp()
WHERE name = %s
"""

COUNT_ATTEMPT = """
UPDATE plyr_moderation.rule_cursors
SET attempts = attempts + 1, updated_at = clock_timestamp()
WHERE name = %s
RETURNING attempts
"""


@dataclass(frozen=True)
class IndexedTrack:
    uri: str
    cid: str
    did: str
    title: str
    audio_url: str | None
    indexed_at_us: int
    handle: str
    display_name: str
    # this audio was fingerprinted on an earlier pass (the record was edited)
    scanned_before: bool

    def action_data(self) -> dict[str, Any]:
        return {
            'uri': self.uri,
            'cid': self.cid,
            'did': self.did,
            'title': self.title,
            'audio_url': self.audio_url,
            'handle': self.handle,
            'display_name': self.display_name,
            'scanned_before': self.scanned_before,
        }


@dataclass(frozen=True)
class Flag:
    subject: str
    action: str
    actor: str
    reason: str


def plain_dsn(url: str) -> str:
    """drop a SQLAlchemy driver suffix (postgresql+psycopg://) that libpq doesn't read."""
    scheme, sep, rest = url.partition('://')
    return f'{scheme.split("+", 1)[0]}{sep}{rest}'


class Store:
    def __init__(self, dsn: str, collection: str) -> None:
        self._dsn = plain_dsn(dsn)
        self._collection = collection
        self._conn: psycopg2.extensions.connection | None = None

    def _connection(self) -> psycopg2.extensions.connection:
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(self._dsn, application_name='plyr-next-osprey')
        return self._conn

    def close(self) -> None:
        if self._conn is not None and not self._conn.closed:
            self._conn.close()

    def cursor_position(self, start_at_us: int | None = None) -> tuple[int, str]:
        """where the walk resumes. a first run starts now (or at start_at_us), not at the
        beginning of the catalog: prod already scanned what came before."""
        conn = self._connection()
        with conn, conn.cursor() as cur:
            start = start_at_us if start_at_us is not None else time.time_ns() // 1000
            cur.execute(START_CURSOR, (CURSOR_NAME, start))
            cur.execute(SELECT_CURSOR, (CURSOR_NAME,))
            row = cur.fetchone()
        assert row is not None
        return int(row[0]), str(row[1])

    def tracks_after(self, position: tuple[int, str], limit: int) -> list[IndexedTrack]:
        conn = self._connection()
        with conn, conn.cursor() as cur:
            cur.execute(SELECT_TRACKS, (self._collection, position[0], position[1], limit))
            rows = cur.fetchall()
        return [IndexedTrack(*row) for row in rows]

    def finish(self, track: IndexedTrack, flags: Sequence[Flag], scanned: list[str] | None) -> None:
        """record what the rules found for one track and move the cursor past it."""
        conn = self._connection()
        with conn, conn.cursor() as cur:
            for flag in flags:
                cur.execute(INSERT_FLAG, (flag.subject, flag.action, flag.actor, flag.reason or None))
            if scanned is not None and track.audio_url:
                cur.execute(INSERT_SCAN, (track.uri, track.cid, track.audio_url, len(scanned)))
            cur.execute(ADVANCE, (track.indexed_at_us, track.uri, CURSOR_NAME))

    def failed(self, track: IndexedTrack) -> bool:
        """count a failed run on the track at the cursor. returns whether it was passed over."""
        conn = self._connection()
        with conn, conn.cursor() as cur:
            cur.execute(COUNT_ATTEMPT, (CURSOR_NAME,))
            row = cur.fetchone()
            attempts = int(row[0]) if row else 0
            if attempts < MAX_ATTEMPTS:
                return False
            cur.execute(ADVANCE, (track.indexed_at_us, track.uri, CURSOR_NAME))
        return True
