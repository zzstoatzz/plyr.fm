"""the uploader's scan budget: seconds of audio fingerprinted per day, from next's
quotas (plyr_quota, next/backend migration 0064). the database decides, so the
worker and the api answer "may this account spend this now?" the same way: by
tier (new, established once enough scans came back clean, or one an operator
set), within the day's ceiling for everyone together.

a scan the budget can't cover now isn't skipped: the track is held out of
discovery and the worker comes back to it when the day turns over.
"""

from typing import Protocol

import psycopg2
import psycopg2.extensions

METER = 'scan_seconds'


class Budget(Protocol):
    def spend(self, owner_did: str, seconds: int) -> bool: ...

    def release(self, owner_did: str, seconds: int) -> None: ...


class PostgresBudget:
    """spends commit at once, apart from the record's own transaction: a scan
    costs money the moment AuDD hears it, whatever happens to the run after."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._conn: psycopg2.extensions.connection | None = None
        # the window each account's last spend landed in, so a release gives it back there
        self._windows: dict[str, int] = {}

    def _connection(self) -> psycopg2.extensions.connection:
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(self._dsn, application_name='plyr-next-osprey-budget')
            self._conn.autocommit = True
        return self._conn

    def spend(self, owner_did: str, seconds: int) -> bool:
        with self._connection().cursor() as cur:
            cur.execute('SELECT granted, retry_at_us FROM plyr_quota.spend(%s, %s, %s)', (METER, owner_did, seconds))
            row = cur.fetchone()
        if not row or not row[0]:
            return False
        self._windows[owner_did] = int(row[1])
        return True

    def release(self, owner_did: str, seconds: int) -> None:
        window = self._windows.pop(owner_did, None)
        if window is None:
            return
        with self._connection().cursor() as cur:
            cur.execute('SELECT plyr_quota.release(%s, %s, %s, %s)', (METER, owner_did, seconds, window))

    def close(self) -> None:
        if self._conn is not None and not self._conn.closed:
            self._conn.close()


class Unconfigured:
    def spend(self, owner_did: str, seconds: int) -> bool:
        raise RuntimeError('no scan budget configured')

    def release(self, owner_did: str, seconds: int) -> None:
        raise RuntimeError('no scan budget configured')
