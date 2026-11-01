#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["asyncpg", "pydantic-settings"]
# ///
"""all-time community stats for the plyr.fm one-year anniversary.

read-only: the session is set to READ ONLY before any query runs.

usage:
    uv run scripts/anniversary_stats.py                 # prod, writes ./anniversary-stats/
    uv run scripts/anniversary_stats.py --env stg --out /tmp/stats

set NEON_DATABASE_URL_PRD (or NEON_DATABASE_URL) in .env.

listener identity: track_plays has no listener column, so "who listens most"
is approximated by engagement given (likes, comments, jams, playlists, shares).
"""

import argparse
import asyncio
import csv
import re
from pathlib import Path

import asyncpg
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    neon_database_url: str | None = None
    neon_database_url_prd: str | None = None
    neon_database_url_stg: str | None = None
    neon_database_url_dev: str | None = None

    def get_url(self, env: str) -> str:
        url = getattr(self, f"neon_database_url_{env}", None) or self.neon_database_url
        if not url:
            raise SystemExit(f"no database url for {env}: set NEON_DATABASE_URL_{env.upper()}")
        return re.sub(r"postgresql\+\w+://", "postgresql://", url)


QUERIES: dict[str, str] = {
    # every uploader, ranked by plays received
    "artists": """
        WITH t AS (
            SELECT artist_did, count(*) AS tracks, min(created_at) AS first_upload,
                   max(created_at) AS last_upload, sum(play_count) AS play_count_total
            FROM tracks GROUP BY artist_did
        ), l AS (
            SELECT tr.artist_did, count(*) AS likes_received,
                   count(DISTINCT tl.user_did) AS distinct_likers
            FROM track_likes tl JOIN tracks tr ON tr.id = tl.track_id
            WHERE tl.user_did <> tr.artist_did GROUP BY tr.artist_did
        ), c AS (
            SELECT tr.artist_did, count(*) AS comments_received
            FROM track_comments tc JOIN tracks tr ON tr.id = tc.track_id
            WHERE tc.user_did <> tr.artist_did GROUP BY tr.artist_did
        ), al AS (
            SELECT artist_did, count(*) AS albums FROM albums GROUP BY artist_did
        )
        SELECT a.handle, a.display_name, a.did, t.tracks, coalesce(al.albums, 0) AS albums,
               t.first_upload, t.last_upload, t.play_count_total,
               coalesce(l.likes_received, 0) AS likes_received,
               coalesce(l.distinct_likers, 0) AS distinct_likers,
               coalesce(c.comments_received, 0) AS comments_received
        FROM t JOIN artists a ON a.did = t.artist_did
        LEFT JOIN l ON l.artist_did = t.artist_did
        LEFT JOIN c ON c.artist_did = t.artist_did
        LEFT JOIN al ON al.artist_did = t.artist_did
        ORDER BY t.play_count_total DESC
    """,
    # every account, ranked by engagement given to other people's music
    "listeners": """
        WITH lk AS (
            SELECT tl.user_did AS did, count(*) AS likes_given,
                   count(DISTINCT tr.artist_did) AS artists_liked,
                   min(tl.created_at) AS first_like
            FROM track_likes tl JOIN tracks tr ON tr.id = tl.track_id
            WHERE tl.user_did <> tr.artist_did GROUP BY tl.user_did
        ), cm AS (
            SELECT tc.user_did AS did, count(*) AS comments_given,
                   count(DISTINCT tr.artist_did) AS artists_commented
            FROM track_comments tc JOIN tracks tr ON tr.id = tc.track_id
            WHERE tc.user_did <> tr.artist_did GROUP BY tc.user_did
        ), jh AS (
            SELECT host_did AS did, count(*) AS jams_hosted FROM jams GROUP BY host_did
        ), jp AS (
            SELECT did, count(DISTINCT jam_id) AS jams_joined FROM jam_participants GROUP BY did
        ), pl AS (
            SELECT owner_did AS did, count(*) AS playlists, sum(track_count) AS playlist_tracks
            FROM playlists GROUP BY owner_did
        ), sh AS (
            SELECT creator_did AS did, count(*) AS share_links FROM share_links GROUP BY creator_did
        )
        SELECT a.handle, a.display_name, a.did, a.created_at AS joined,
               coalesce(lk.likes_given, 0) AS likes_given,
               coalesce(lk.artists_liked, 0) AS artists_liked,
               coalesce(cm.comments_given, 0) AS comments_given,
               coalesce(cm.artists_commented, 0) AS artists_commented,
               coalesce(jh.jams_hosted, 0) AS jams_hosted,
               coalesce(jp.jams_joined, 0) AS jams_joined,
               coalesce(pl.playlists, 0) AS playlists,
               coalesce(pl.playlist_tracks, 0) AS playlist_tracks,
               coalesce(sh.share_links, 0) AS share_links,
               lk.first_like
        FROM artists a
        LEFT JOIN lk ON lk.did = a.did LEFT JOIN cm ON cm.did = a.did
        LEFT JOIN jh ON jh.did = a.did LEFT JOIN jp ON jp.did = a.did
        LEFT JOIN pl ON pl.did = a.did LEFT JOIN sh ON sh.did = a.did
        WHERE coalesce(lk.likes_given, 0) + coalesce(cm.comments_given, 0)
            + coalesce(jh.jams_hosted, 0) + coalesce(jp.jams_joined, 0)
            + coalesce(pl.playlists, 0) + coalesce(sh.share_links, 0) > 0
        ORDER BY coalesce(lk.likes_given, 0) + 3 * coalesce(cm.comments_given, 0)
            + 2 * coalesce(jp.jams_joined, 0) + 2 * coalesce(pl.playlists, 0) DESC
    """,
    # the first 50 accounts and their first upload, if any
    "first_accounts": """
        SELECT a.handle, a.display_name, a.created_at AS joined,
               min(t.created_at) AS first_upload, min(t.id) AS first_track_id
        FROM artists a LEFT JOIN tracks t ON t.artist_did = a.did
        GROUP BY a.did, a.handle, a.display_name, a.created_at
        ORDER BY a.created_at LIMIT 50
    """,
    # the first 30 tracks ever
    "first_tracks": """
        SELECT t.id, t.title, a.handle, t.created_at, t.play_count
        FROM tracks t JOIN artists a ON a.did = t.artist_did
        ORDER BY t.id LIMIT 30
    """,
    "top_tracks_by_plays": """
        SELECT t.id, t.title, a.handle, t.created_at, t.play_count
        FROM tracks t JOIN artists a ON a.did = t.artist_did
        ORDER BY t.play_count DESC LIMIT 30
    """,
    "top_tracks_by_likes": """
        SELECT t.id, t.title, a.handle, count(*) AS likes
        FROM track_likes tl JOIN tracks t ON t.id = tl.track_id
        JOIN artists a ON a.did = t.artist_did
        GROUP BY t.id, t.title, a.handle ORDER BY likes DESC LIMIT 30
    """,
    "top_tracks_by_comments": """
        SELECT t.id, t.title, a.handle, count(*) AS comments,
               count(DISTINCT tc.user_did) AS commenters
        FROM track_comments tc JOIN tracks t ON t.id = tc.track_id
        JOIN artists a ON a.did = t.artist_did
        GROUP BY t.id, t.title, a.handle ORDER BY comments DESC LIMIT 30
    """,
    # who likes whose music: the strongest listener -> artist pairs
    "fan_pairs": """
        SELECT fan.handle AS fan, art.handle AS artist, count(*) AS likes
        FROM track_likes tl JOIN tracks t ON t.id = tl.track_id
        JOIN artists fan ON fan.did = tl.user_did
        JOIN artists art ON art.did = t.artist_did
        WHERE tl.user_did <> t.artist_did
        GROUP BY fan.handle, art.handle ORDER BY likes DESC LIMIT 50
    """,
    "jams": """
        SELECT j.code, j.name, h.handle AS host, j.created_at, j.ended_at,
               count(DISTINCT p.did) AS participants
        FROM jams j JOIN artists h ON h.did = j.host_did
        LEFT JOIN jam_participants p ON p.jam_id = j.id
        GROUP BY j.id, j.code, j.name, h.handle, j.created_at, j.ended_at
        ORDER BY participants DESC, j.created_at LIMIT 30
    """,
    "monthly": """
        WITH m AS (
            SELECT generate_series(date_trunc('month', (SELECT min(created_at) FROM artists)),
                                   date_trunc('month', now()), interval '1 month') AS month
        )
        SELECT m.month::date AS month,
            (SELECT count(*) FROM artists WHERE date_trunc('month', created_at) = m.month) AS new_accounts,
            (SELECT count(*) FROM tracks WHERE date_trunc('month', created_at) = m.month) AS uploads,
            (SELECT count(DISTINCT artist_did) FROM tracks WHERE date_trunc('month', created_at) = m.month) AS active_uploaders,
            (SELECT count(*) FROM track_likes WHERE date_trunc('month', created_at) = m.month) AS likes,
            (SELECT count(*) FROM track_comments WHERE date_trunc('month', created_at) = m.month) AS comments,
            (SELECT count(*) FROM jams WHERE date_trunc('month', created_at) = m.month) AS jams,
            (SELECT count(*) FROM track_plays WHERE date_trunc('month', played_at) = m.month) AS plays_logged
        FROM m ORDER BY m.month
    """,
    "totals": """
        SELECT (SELECT count(*) FROM artists) AS accounts,
               (SELECT count(DISTINCT artist_did) FROM tracks) AS uploaders,
               (SELECT count(*) FROM tracks) AS tracks,
               (SELECT sum(play_count) FROM tracks) AS play_count_total,
               (SELECT count(*) FROM track_plays) AS plays_logged,
               (SELECT count(*) FROM track_likes) AS likes,
               (SELECT count(*) FROM track_comments) AS comments,
               (SELECT count(*) FROM albums) AS albums,
               (SELECT count(*) FROM playlists) AS playlists,
               (SELECT count(*) FROM jams) AS jams,
               (SELECT min(created_at) FROM artists) AS first_account,
               (SELECT min(created_at) FROM tracks) AS first_upload
    """,
}


async def main(env: str, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    conn = await asyncpg.connect(Settings().get_url(env))
    try:
        await conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        for name, sql in QUERIES.items():
            rows = await conn.fetch(sql)
            path = out / f"{name}.csv"
            with path.open("w", newline="") as f:
                w = csv.writer(f)
                if rows:
                    w.writerow(rows[0].keys())
                    w.writerows([list(r.values()) for r in rows])
            print(f"{name}: {len(rows)} rows -> {path}")
    finally:
        await conn.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--env", default="prd", choices=["prd", "stg", "dev"])
    p.add_argument("--out", type=Path, default=Path("anniversary-stats"))
    a = p.parse_args()
    asyncio.run(main(a.env, a.out))
