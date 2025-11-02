"""migrate existing tracks to use Artist model.

this script:
1. creates artists table
2. extracts unique artist data from tracks
3. fetches avatars from bluesky
4. creates artist records
5. adds foreign key constraint
6. drops old artist fields from tracks
"""

import asyncio
import sys
from pathlib import Path

# add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import httpx
from sqlalchemy import text

from relay.models import get_db


async def fetch_avatar(did: str) -> str | None:
    """fetch avatar from bluesky."""
    url = f"https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor={did}"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=10.0)
            if response.status_code == 200:
                data = response.json()
                return data.get("avatar")
        except Exception as e:
            print(f"error fetching avatar for {did}: {e}")
    return None


async def main():
    """run migration."""
    db = next(get_db())

    try:
        # step 1: create artists table
        print("creating artists table...")
        db.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS artists (
                did VARCHAR PRIMARY KEY,
                handle VARCHAR NOT NULL,
                display_name VARCHAR NOT NULL,
                bio VARCHAR,
                avatar_url VARCHAR,
                created_at TIMESTAMP NOT NULL,
                updated_at TIMESTAMP NOT NULL
            )
        """
            )
        )
        db.commit()
        print("✓ artists table created")

        # step 2: extract unique artists from tracks
        print("\nextracting unique artists from tracks...")
        result = db.execute(
            text(
                """
            SELECT DISTINCT
                artist_did,
                artist_handle,
                (ARRAY_AGG(artist ORDER BY id))[1] as display_name
            FROM tracks
            WHERE artist_did IS NOT NULL
            GROUP BY artist_did, artist_handle
        """
            )
        )
        unique_artists = result.fetchall()
        print(f"✓ found {len(unique_artists)} unique artist(s)")

        # step 3 & 4: fetch avatars and create artist records
        print("\ncreating artist records...")
        for row in unique_artists:
            did, handle, display_name = row
            print("\nprocessing artist:")
            print(f"  did: {did}")
            print(f"  handle: {handle}")
            print(f"  display_name: {display_name}")

            # fetch avatar
            print("  fetching avatar from bluesky...")
            avatar_url = await fetch_avatar(did)
            if avatar_url:
                print(f"  ✓ avatar found: {avatar_url}")
            else:
                print("  ✗ no avatar found")

            # create artist record
            from datetime import datetime

            db.execute(
                text(
                    """
                INSERT INTO artists (did, handle, display_name, bio, avatar_url, created_at, updated_at)
                VALUES (:did, :handle, :display_name, NULL, :avatar_url, :created_at, :updated_at)
                ON CONFLICT (did) DO NOTHING
            """
                ),
                {
                    "did": did,
                    "handle": handle,
                    "display_name": display_name,
                    "avatar_url": avatar_url,
                    "created_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow(),
                },
            )
            db.commit()
            print("  ✓ artist record created")

        # step 5: add foreign key constraint
        print("\nadding foreign key constraint...")
        db.execute(
            text(
                """
            ALTER TABLE tracks
            ADD CONSTRAINT fk_tracks_artist_did
            FOREIGN KEY (artist_did) REFERENCES artists(did)
        """
            )
        )
        db.commit()
        print("✓ foreign key constraint added")

        # step 6: drop old columns
        print("\ndropping old artist columns from tracks...")
        db.execute(text("ALTER TABLE tracks DROP COLUMN artist"))
        db.execute(text("ALTER TABLE tracks DROP COLUMN artist_handle"))
        db.commit()
        print("✓ old columns dropped")

        print("\n" + "=" * 60)
        print("migration completed successfully!")
        print("=" * 60)

    except Exception as e:
        print(f"\nerror during migration: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
