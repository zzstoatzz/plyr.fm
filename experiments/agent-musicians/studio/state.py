"""Durable session reservations and musician memory."""

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path


class Store:
    def __init__(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / "studio.sqlite3"
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS musicians (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY, day TEXT NOT NULL, month TEXT NOT NULL,
                    status TEXT NOT NULL, reserved REAL NOT NULL, spent REAL NOT NULL DEFAULT 0,
                    calls INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS studies (
                    session TEXT NOT NULL, musician TEXT NOT NULL, body TEXT NOT NULL,
                    PRIMARY KEY(session, musician));
            """)
            expiry = (datetime.now(UTC) + timedelta(days=7)).isoformat()
            db.execute(
                "INSERT OR IGNORE INTO settings VALUES (?, ?)", ("expires_at", expiry)
            )

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=30)

    def reserve(self, now: datetime) -> str | None:
        day, month = now.strftime("%Y-%m-%d"), now.strftime("%Y-%m")
        key = f"{day}-{now.hour // 6}"
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            expiry = db.execute(
                "SELECT value FROM settings WHERE key='expires_at'"
            ).fetchone()[0]
            if now >= datetime.fromisoformat(expiry):
                return None
            if db.execute("SELECT 1 FROM sessions WHERE id=?", (key,)).fetchone():
                return None
            for field, value, limit in [("day", day, 0.20), ("month", month, 5.0)]:
                used = db.execute(
                    f"SELECT COALESCE(SUM(MAX(reserved,spent)),0) FROM sessions WHERE {field}=?",
                    (value,),
                ).fetchone()[0]
                if used + 0.05 > limit + 1e-9:
                    return None
            db.execute(
                "INSERT INTO sessions(id,day,month,status,reserved) VALUES (?,?,?,?,?)",
                (key, day, month, "running", 0.05),
            )
        return key

    def call(self, session: str) -> None:
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                "UPDATE sessions SET calls=calls+1 WHERE id=? AND calls<12 AND spent<0.05",
                (session,),
            ).rowcount
            if not changed:
                raise RuntimeError("Session request or estimated-spend cap reached")

    def charge(self, session: str, cost: float) -> None:
        if cost < 0:
            raise ValueError("Invalid model cost")
        with self.connect() as db:
            db.execute("UPDATE sessions SET spent=spent+? WHERE id=?", (cost, session))

    def musicians(self) -> dict:
        with self.connect() as db:
            return {
                key: json.loads(body)
                for key, body in db.execute("SELECT id,body FROM musicians ORDER BY id")
            }

    def save_musician(self, key: str, body: dict) -> None:
        with self.connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO musicians VALUES (?,?)", (key, json.dumps(body))
            )

    def save_study(self, session: str, musician: str, body: dict) -> None:
        with self.connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO studies VALUES (?,?,?)",
                (session, musician, json.dumps(body)),
            )

    def released_today(self, musician: str, day: str) -> bool:
        with self.connect() as db:
            rows = db.execute(
                "SELECT body FROM studies WHERE musician=? AND session LIKE ?",
                (musician, day + "%"),
            )
            return any(json.loads(body).get("upload_attempted") for (body,) in rows)

    def finish(self, session: str, status: str) -> None:
        with self.connect() as db:
            db.execute("UPDATE sessions SET status=? WHERE id=?", (status, session))
