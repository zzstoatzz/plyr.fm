"""next's Postgres, as the worker sees it: indexed records in, review flags out.

two walks, each with its own cursor in plyr_moderation.rule_cursors, and the
holds:

- `tracks` walks plyr_index.track_records in (ready_at_us, record_uri) order,
  so an edited track comes round again. a track is ready when it was indexed
  or, for audio that lives only as a PDS blob (a record written straight to
  its PDS), when next's verified copy of that blob landed: the copy is what
  next plays and what gets scanned, so such a track comes round again then.
- `covers` walks the cover art of tracks and albums/playlists in
  (indexed_at_us, record_uri) order, however the record was written.
- `holds` has no cursor: it comes back to tracks held for scan budget
  (plyr_moderation.scan_holds) once their day has turned over, before the
  walks take on anything new.

the flags for a record, its scan and the cursor move in one transaction, so a
crash re-runs a record rather than skipping it. a record that keeps failing is
passed over after MAX_ATTEMPTS runs, so one bad file can't stall the queue.
"""

import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlsplit

import psycopg2
import psycopg2.extensions

from plyr_osprey.image_scan import NEXT_IMAGES

MAX_ATTEMPTS = 3

# prod's image bucket: only prod's upload API puts covers there, and it scans them
PROD_IMAGES = ('https://images.plyr.fm/', 'https://pub-7ea7ea9a6f224f4f8c0321a2bb008c5a.r2.dev/')

SELECT_CURSOR = 'SELECT indexed_at_us, record_uri FROM plyr_moderation.rule_cursors WHERE name = %s'

START_CURSOR = """
INSERT INTO plyr_moderation.rule_cursors (name, indexed_at_us, record_uri)
VALUES (%s, %s, '') ON CONFLICT (name) DO NOTHING
"""

# the audio is the address next plays: its verified copy of the record's blob
# (the blob mirror's origin, as playback picks it), else the record's audioUrl
#
# a track's length is the record's, else the one next measured (as
# next/backend's duration_store.effectiveDuration reads it); recent_uploads is
# how many of the uploader's tracks were indexed in the day up to this one
READY_TRACKS = """
WITH ready AS (
    SELECT t.record_uri, t.record_cid, t.owner_did, t.title,
           coalesce(d.origin_url, t.audio_url) AS audio_url,
           greatest(t.indexed_at_us, coalesce(d.observed_at_us, 0)) AS ready_at_us,
           t.indexed_at_us,
           coalesce(t.duration_seconds, (SELECT m.duration_seconds FROM plyr_index.track_measured_durations m
                                         WHERE m.record_uri = t.record_uri AND m.record_cid = t.record_cid)) AS duration
    FROM plyr_index.track_records t
    LEFT JOIN plyr_index.track_delivery_origins d
      ON d.record_uri = t.record_uri AND d.artifact_cid = t.audio_blob_cid
     AND d.service = 'r2' AND d.verification = 'verified_blob_cid'
    WHERE NOT t.deleted AND t.collection = %(collection)s
)
SELECT r.record_uri, r.record_cid, r.owner_did, r.title, r.audio_url, r.ready_at_us,
       coalesce(a.handle, ''), coalesce(a.display_name, ''),
       EXISTS (SELECT 1 FROM plyr_moderation.scans s
               WHERE s.record_uri = r.record_uri AND s.audio_url = r.audio_url),
       coalesce(r.duration, 0)::int,
       (SELECT count(*) FROM plyr_index.track_records o
        WHERE o.owner_did = r.owner_did AND o.collection = %(collection)s AND NOT o.deleted
          AND o.indexed_at_us > r.indexed_at_us - 86400000000 AND o.indexed_at_us <= r.indexed_at_us)::int
FROM ready r
LEFT JOIN plyr_index.actor_identities a ON a.did = r.owner_did
"""

SELECT_TRACKS = (
    READY_TRACKS
    + """
WHERE (r.ready_at_us, r.record_uri) > (%(at)s, %(uri)s)
ORDER BY r.ready_at_us, r.record_uri
LIMIT %(limit)s
"""
)

# held tracks whose day has turned over, oldest hold first
SELECT_HELD = (
    READY_TRACKS
    + """
JOIN plyr_moderation.scan_holds h ON h.record_uri = r.record_uri
WHERE h.retry_at_us <= %(now)s
ORDER BY h.held_at, r.record_uri
LIMIT %(limit)s
"""
)

HOLD = """
INSERT INTO plyr_moderation.scan_holds (record_uri, owner_did, retry_at_us)
VALUES (%s, %s, plyr_quota.window_end_us('scan_seconds'))
ON CONFLICT (record_uri) DO UPDATE SET retry_at_us = EXCLUDED.retry_at_us
"""

RELEASE_HOLD = 'DELETE FROM plyr_moderation.scan_holds WHERE record_uri = %s'

COUNT_HOLD_ATTEMPT = """
UPDATE plyr_moderation.scan_holds SET attempts = attempts + 1 WHERE record_uri = %s RETURNING attempts
"""

RECORD_OUTCOME = 'SELECT plyr_quota.record_outcome(%s, %s)'

# a track names its cover as imageUrl (next writes the cover's getBlob URL
# there); an album or playlist names it as imageBlob
SELECT_COVERS = """
WITH covers AS (
    SELECT record_uri, record_cid, owner_did, coalesce(title, '') AS title, image_url, NULL::text AS blob_cid,
           indexed_at_us
    FROM plyr_index.track_records
    WHERE NOT deleted AND collection = %s AND image_url IS NOT NULL
    UNION ALL
    SELECT record_uri, record_cid, owner_did, coalesce(name, ''), NULL, cover_blob_cid, indexed_at_us
    FROM plyr_index.list_records
    WHERE NOT deleted AND collection = %s AND cover_blob_cid IS NOT NULL
)
SELECT c.record_uri, c.record_cid, c.owner_did, c.title, c.image_url, c.blob_cid, c.indexed_at_us,
       coalesce(a.handle, ''), coalesce(a.display_name, '')
FROM covers c
LEFT JOIN plyr_index.actor_identities a ON a.did = c.owner_did
WHERE (c.indexed_at_us, c.record_uri) > (%s, %s)
ORDER BY c.indexed_at_us, c.record_uri
LIMIT %s
"""

SCANNED_COVERS = """
SELECT record_uri, image_url FROM plyr_moderation.image_scans
WHERE (record_uri, image_url) IN (SELECT * FROM unnest(%s::text[], %s::text[]))
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

INSERT_IMAGE_SCAN = """
INSERT INTO plyr_moderation.image_scans (record_uri, record_cid, image_url, violations)
VALUES (%s, %s, %s, %s)
ON CONFLICT (record_uri, image_url) DO NOTHING
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
    ready_at_us: int
    handle: str
    display_name: str
    # this audio was fingerprinted on an earlier pass (the record was edited)
    scanned_before: bool
    # 0 when next doesn't know it yet
    duration_seconds: int = 0
    recent_uploads: int = 1

    cursor = 'tracks'
    action_name = 'track'
    held = False

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
            'duration_seconds': self.duration_seconds,
            'recent_uploads': self.recent_uploads,
            'held': self.held,
        }


@dataclass(frozen=True)
class HeldTrack(IndexedTrack):
    """a track held for scan budget, come round again once its day turned over.
    it has no cursor: the hold is what brings it back."""

    cursor = 'holds'
    held = True


@dataclass(frozen=True)
class IndexedCover:
    """the cover art of a track or an album/playlist record."""

    uri: str
    cid: str
    did: str
    title: str
    # what next shows; None when it isn't next's to scan (prod's bucket, not https)
    cover_url: str | None
    ready_at_us: int
    handle: str
    display_name: str
    scanned_before: bool

    cursor = 'covers'
    action_name = 'cover'

    def action_data(self) -> dict[str, Any]:
        return {
            'uri': self.uri,
            'cid': self.cid,
            'did': self.did,
            'title': self.title,
            'cover_url': self.cover_url,
            'handle': self.handle,
            'display_name': self.display_name,
            'scanned_before': self.scanned_before,
        }


Indexed = IndexedTrack | IndexedCover


def cover_url(image_url: str | None, blob_cid: str | None, did: str) -> str | None:
    """the address next shows a cover at, as next/backend's public_media.canonicalImage
    moves it: a PDS blob is served (and checked against its CID) by next's cover worker."""
    if blob_cid:
        return f'{NEXT_IMAGES}{blob_cid}?did={did}'
    if not image_url or not image_url.startswith('https://') or image_url.startswith(PROD_IMAGES):
        return None
    parts = urlsplit(image_url)
    if parts.path.endswith('/xrpc/com.atproto.sync.getBlob'):
        query = parse_qs(parts.query)
        blob_did, cid = query.get('did', [''])[0], query.get('cid', [''])[0]
        if blob_did.startswith('did:') and cid:
            return f'{NEXT_IMAGES}{cid}?did={blob_did}'
    return image_url


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
    def __init__(self, dsn: str, collection: str, list_collection: str = 'fm.plyr.list') -> None:
        self._dsn = plain_dsn(dsn)
        self._collection = collection
        self._list_collection = list_collection
        self._conn: psycopg2.extensions.connection | None = None

    def _connection(self) -> psycopg2.extensions.connection:
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(self._dsn, application_name='plyr-next-osprey')
        return self._conn

    def close(self) -> None:
        if self._conn is not None and not self._conn.closed:
            self._conn.close()

    def cursor_position(self, name: str, start_at_us: int | None = None) -> tuple[int, str]:
        """where a walk resumes. a first run starts now (or at start_at_us), not at the
        beginning of the catalog."""
        conn = self._connection()
        with conn, conn.cursor() as cur:
            start = start_at_us if start_at_us is not None else time.time_ns() // 1000
            cur.execute(START_CURSOR, (name, start))
            cur.execute(SELECT_CURSOR, (name,))
            row = cur.fetchone()
        assert row is not None
        return int(row[0]), str(row[1])

    def tracks_after(self, position: tuple[int, str], limit: int) -> list[IndexedTrack]:
        conn = self._connection()
        with conn, conn.cursor() as cur:
            cur.execute(
                SELECT_TRACKS, {'collection': self._collection, 'at': position[0], 'uri': position[1], 'limit': limit}
            )
            rows = cur.fetchall()
        return [IndexedTrack(*row) for row in rows]

    def held_due(self, limit: int) -> list[IndexedTrack]:
        conn = self._connection()
        with conn, conn.cursor() as cur:
            cur.execute(SELECT_HELD, {'collection': self._collection, 'now': time.time_ns() // 1000, 'limit': limit})
            rows = cur.fetchall()
        return [HeldTrack(*row) for row in rows]

    def covers_after(self, position: tuple[int, str], limit: int) -> list[IndexedCover]:
        conn = self._connection()
        with conn, conn.cursor() as cur:
            cur.execute(SELECT_COVERS, (self._collection, self._list_collection, position[0], position[1], limit))
            rows = cur.fetchall()
            found = [
                (uri, cid, did, title, cover_url(image, blob, did), at, handle, name)
                for uri, cid, did, title, image, blob, at, handle, name in rows
            ]
            scanned: set[tuple[str, str]] = set()
            pairs = [(row[0], row[4]) for row in found if row[4]]
            if pairs:
                cur.execute(SCANNED_COVERS, ([p[0] for p in pairs], [p[1] for p in pairs]))
                scanned = {(str(a), str(b)) for a, b in cur.fetchall()}
        return [IndexedCover(*row, (row[0], row[4]) in scanned) for row in found]

    def after(self, cursor: str, position: tuple[int, str], limit: int) -> Sequence[Indexed]:
        if cursor == HeldTrack.cursor:
            return self.held_due(limit)
        return (
            self.tracks_after(position, limit) if cursor == IndexedTrack.cursor else self.covers_after(position, limit)
        )

    def finish(self, item: Indexed, flags: Sequence[Flag], scanned: list[str] | None, held: bool = False) -> None:
        """record what the rules found for one record and move its cursor past it.

        a track the rules held for scan budget is held (or held again) until the
        day turns over; any other track's hold is gone, so it is back in discovery.
        """
        conn = self._connection()
        with conn, conn.cursor() as cur:
            for flag in flags:
                cur.execute(INSERT_FLAG, (flag.subject, flag.action, flag.actor, flag.reason or None))
            if scanned is not None:
                if isinstance(item, IndexedTrack) and item.audio_url:
                    cur.execute(INSERT_SCAN, (item.uri, item.cid, item.audio_url, len(scanned)))
                    cur.execute(RECORD_OUTCOME, (item.did, len(scanned) == 0))
                elif isinstance(item, IndexedCover) and item.cover_url:
                    cur.execute(INSERT_IMAGE_SCAN, (item.uri, item.cid, item.cover_url, len(scanned)))
            if isinstance(item, IndexedTrack):
                if held:
                    cur.execute(HOLD, (item.uri, item.did))
                else:
                    cur.execute(RELEASE_HOLD, (item.uri,))
            if not isinstance(item, HeldTrack):
                cur.execute(ADVANCE, (item.ready_at_us, item.uri, item.cursor))

    def failed(self, item: Indexed) -> bool:
        """count a failed run on the record at its cursor. returns whether it was passed over.

        a held track that keeps failing loses its hold, like a track passed over
        on the walk: it isn't scanned, and discovery no longer waits for it."""
        conn = self._connection()
        with conn, conn.cursor() as cur:
            if isinstance(item, HeldTrack):
                cur.execute(COUNT_HOLD_ATTEMPT, (item.uri,))
                row = cur.fetchone()
                if row and int(row[0]) < MAX_ATTEMPTS:
                    return False
                cur.execute(RELEASE_HOLD, (item.uri,))
                return True
            cur.execute(COUNT_ATTEMPT, (item.cursor,))
            row = cur.fetchone()
            attempts = int(row[0]) if row else 0
            if attempts < MAX_ATTEMPTS:
                return False
            cur.execute(ADVANCE, (item.ready_at_us, item.uri, item.cursor))
        return True
