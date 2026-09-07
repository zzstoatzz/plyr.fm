"""Durable session reservations and musician memory."""

import json
import math
import sqlite3
from datetime import datetime
from pathlib import Path

SESSION_BUDGET = 0.10
DAILY_BUDGET = 10.0
MONTHLY_BUDGET = 10.0


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
                CREATE TABLE IF NOT EXISTS listening_reviews (
                    session TEXT NOT NULL, musician TEXT NOT NULL, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS studies (
                    session TEXT NOT NULL, musician TEXT NOT NULL, body TEXT NOT NULL,
                    PRIMARY KEY(session, musician));
            """)

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=30)

    def reserve(
        self, now: datetime, retry_failed: bool = False, *, bootstrap: bool = False
    ) -> str | None:
        day, month = now.strftime("%Y-%m-%d"), now.strftime("%Y-%m")
        key = f"{day}-{now.hour // 6}" + ("-bootstrap" if bootstrap else "")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if bootstrap:
                prior = db.execute(
                    "SELECT id FROM sessions WHERE id LIKE '%-bootstrap'"
                ).fetchone()
                if prior and prior[0] != key:
                    return None
            existing = db.execute(
                "SELECT status,spent,calls FROM sessions WHERE id=?", (key,)
            ).fetchone()
            if existing:
                if (
                    retry_failed
                    and existing[0] == "failed"
                    and existing[1] < SESSION_BUDGET
                    and existing[2] < 12
                ):
                    db.execute(
                        "UPDATE sessions SET status='running' WHERE id=?", (key,)
                    )
                    return key
                return None
            for field, value, limit in [
                ("day", day, DAILY_BUDGET),
                ("month", month, MONTHLY_BUDGET),
            ]:
                used = db.execute(
                    f"SELECT COALESCE(SUM(MAX(reserved,spent)),0) FROM sessions WHERE {field}=?",
                    (value,),
                ).fetchone()[0]
                if used + SESSION_BUDGET > limit + 1e-9:
                    return None
            db.execute(
                "INSERT INTO sessions(id,day,month,status,reserved) VALUES (?,?,?,?,?)",
                (key, day, month, "running", SESSION_BUDGET),
            )
        return key

    def call(self, session: str) -> None:
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                "UPDATE sessions SET calls=calls+1 WHERE id=? AND status='running' AND calls<12 AND spent<?",
                (session, SESSION_BUDGET),
            ).rowcount
            if not changed:
                raise RuntimeError("Session request or estimated-spend cap reached")

    def charge(self, session: str, cost: float) -> None:
        if not math.isfinite(cost) or cost < 0:
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

    def study(self, session: str, musician: str) -> dict | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT body FROM studies WHERE session=? AND musician=?",
                (session, musician),
            ).fetchone()
            return json.loads(row[0]) if row else None

    def save_study(self, session: str, musician: str, body: dict) -> None:
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT body FROM studies WHERE session=? AND musician=?",
                (session, musician),
            ).fetchone()
            previous = json.loads(row[0]) if row else {}
            merged = {**previous, **body}
            for key in ("upload_attempted", "upload_id", "track_id"):
                if key in previous:
                    merged[key] = previous[key]
            db.execute(
                "INSERT OR REPLACE INTO studies VALUES (?,?,?)",
                (session, musician, json.dumps(merged)),
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

    def usage(self, now: datetime) -> dict:
        with self.connect() as db:

            def totals(field: str, value: str) -> dict:
                row = db.execute(
                    f"SELECT COUNT(*), COALESCE(SUM(calls),0), COALESCE(SUM(spent),0), "
                    f"COALESCE(SUM(MAX(reserved,spent)),0) FROM sessions WHERE {field}=?",
                    (value,),
                ).fetchone()
                return dict(
                    zip(("sessions", "calls", "estimated_cost", "budget_used"), row)
                )

            return {
                "day": totals("day", now.strftime("%Y-%m-%d")),
                "month": totals("month", now.strftime("%Y-%m")),
            }

    def history(
        self,
        musician: str,
        before: str,
        *,
        published: bool = False,
        include_current: bool = False,
    ) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                f"SELECT session,body FROM studies WHERE musician=? AND session{'<=' if include_current else '<'}? "
                "AND json_extract(body,'$.rendered')=1 "
                "AND (?=0 OR json_extract(body,'$.track_id') IS NOT NULL) "
                "ORDER BY session DESC LIMIT 3",
                (musician, before, int(published)),
            ).fetchall()
        return [{"session": session, **json.loads(body)} for session, body in rows]

    def claim_upload(self, session: str, musician: str) -> bool:
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute(
                "SELECT body FROM studies WHERE musician=? AND session LIKE ?",
                (musician, session[:10] + "%"),
            ).fetchall()
            if any(json.loads(row[0]).get("upload_attempted") for row in rows):
                return False
            row = db.execute(
                "SELECT body FROM studies WHERE session=? AND musician=?",
                (session, musician),
            ).fetchone()
            if row is None:
                raise ValueError("A saved composition is required before upload")
            body = json.loads(row[0])
            body["upload_attempted"] = True
            db.execute(
                "UPDATE studies SET body=? WHERE session=? AND musician=?",
                (json.dumps(body), session, musician),
            )
            return True

    def listening_reviews(self, session: str, musician: str) -> list[dict]:
        with self.connect() as db:
            return [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT body FROM listening_reviews WHERE session=? AND musician=?",
                    (session, musician),
                )
            ]
