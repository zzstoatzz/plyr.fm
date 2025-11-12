#!/usr/bin/env python3
"""admin script to simulate broken ATProto records for local testing.

usage:
    uv run scripts/simulate_broken_tracks.py <track_id> [<track_id> ...]
    uv run scripts/simulate_broken_tracks.py --restore <track_id>

this will:
- nullify atproto_record_uri and atproto_record_cid for specified tracks
- optionally restore the original values from backup

environment variables (defaults to local dev):
    DATABASE_URL - database connection string (defaults to local postgres)

examples:
    # break tracks 1 and 2 for testing
    uv run scripts/simulate_broken_tracks.py 1 2

    # restore track 1
    uv run scripts/simulate_broken_tracks.py --restore 1

    # break all tracks for a specific artist
    uv run scripts/simulate_broken_tracks.py --artist-did did:plc:...
"""

import asyncio
import sys
from pathlib import Path

# add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


async def break_track(track_id: int) -> None:
    """nullify ATProto record fields for a track and delete from PDS."""
    import subprocess

    from dotenv import load_dotenv
    from sqlalchemy import select

    from backend.models import Track
    from backend.utilities.database import db_session

    async with db_session() as db:
        # fetch track first to show current state
        result = await db.execute(select(Track).where(Track.id == track_id))
        track = result.scalar_one_or_none()

        if not track:
            print(f"❌ track {track_id} not found")
            return

        if not track.atproto_record_uri:
            print(f"⚠️  track {track_id} already has null ATProto record")
            print(f"  title: {track.title}")
            return

        print(f"\n🔧 breaking ATProto record for track {track_id}:")
        print(f"  title: {track.title}")
        print(f"  artist: {track.artist_did}")
        print(f"  current uri: {track.atproto_record_uri}")
        print(f"  current cid: {track.atproto_record_cid}")

        # delete from PDS first
        load_dotenv()
        import os

        handle = os.getenv("ATPROTO_MAIN_HANDLE")
        password = os.getenv("ATPROTO_MAIN_PASSWORD")

        if handle and password:
            print("  deleting from PDS...")
            result = subprocess.run(
                [
                    "uvx",
                    "pdsx",
                    "--pds",
                    "https://pds.zzstoatzz.io",
                    "--handle",
                    handle,
                    "--password",
                    password,
                    "rm",
                    track.atproto_record_uri,
                ],
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                print("  ✓ deleted from PDS")
            else:
                print(f"  ⚠️  PDS deletion failed: {result.stderr}")
                print("  continuing with DB nullification...")
        else:
            print("  ⚠️  ATPROTO_MAIN_HANDLE/PASSWORD not set, skipping PDS deletion")

        # store original values in extra field for potential restoration
        if track.extra is None:
            track.extra = {}
        track.extra["_backup_atproto_uri"] = track.atproto_record_uri
        track.extra["_backup_atproto_cid"] = track.atproto_record_cid

        # nullify the fields
        track.atproto_record_uri = None
        track.atproto_record_cid = None

        await db.commit()

        print(f"✅ track {track_id} ATProto record nullified")
        print("  (backup stored in extra field for restoration)")


async def restore_track(track_id: int) -> None:
    """restore ATProto record fields from backup."""
    from sqlalchemy import select

    from backend.models import Track
    from backend.utilities.database import db_session

    async with db_session() as db:
        result = await db.execute(select(Track).where(Track.id == track_id))
        track = result.scalar_one_or_none()

        if not track:
            print(f"❌ track {track_id} not found")
            return

        if not track.extra or "_backup_atproto_uri" not in track.extra:
            print(f"❌ no backup found for track {track_id}")
            return

        print(f"\n🔄 restoring ATProto record for track {track_id}:")
        print(f"  title: {track.title}")
        print(f"  backup uri: {track.extra['_backup_atproto_uri']}")
        print(f"  backup cid: {track.extra['_backup_atproto_cid']}")

        # restore from backup
        track.atproto_record_uri = track.extra["_backup_atproto_uri"]
        track.atproto_record_cid = track.extra["_backup_atproto_cid"]

        # clean up backup
        del track.extra["_backup_atproto_uri"]
        del track.extra["_backup_atproto_cid"]

        await db.commit()

        print(f"✅ track {track_id} ATProto record restored")


async def break_artist_tracks(artist_did: str) -> None:
    """break all tracks for a specific artist."""
    from sqlalchemy import select

    from backend.models import Track
    from backend.utilities.database import db_session

    async with db_session() as db:
        result = await db.execute(select(Track).where(Track.artist_did == artist_did))
        tracks = result.scalars().all()

        if not tracks:
            print(f"❌ no tracks found for artist {artist_did}")
            return

        print(f"\n🔧 breaking {len(tracks)} tracks for artist {artist_did}:")
        for track in tracks:
            if track.atproto_record_uri:
                await break_track(track.id)
            else:
                print(f"⏭️  skipping track {track.id} (already broken)")


async def list_broken_tracks() -> None:
    """list all tracks with null ATProto records."""
    from sqlalchemy import select

    from backend.models import Track
    from backend.utilities.database import db_session

    async with db_session() as db:
        stmt = select(Track).where(
            (Track.atproto_record_uri.is_(None)) | (Track.atproto_record_uri == "")
        )
        result = await db.execute(stmt)
        tracks = result.scalars().all()

        if not tracks:
            print("✅ no broken tracks found")
            return

        print(f"\n📋 found {len(tracks)} broken tracks:")
        for track in tracks:
            has_backup = (
                track.extra and "_backup_atproto_uri" in track.extra
                if track.extra
                else False
            )
            print(f"  - track {track.id}: {track.title}")
            print(f"    artist: {track.artist_did}")
            if has_backup:
                print("    ✓ has backup (can restore)")
            else:
                print("    ✗ no backup (truly broken)")


async def main() -> None:
    """main entry point."""
    if len(sys.argv) < 2:
        print("usage: uv run scripts/simulate_broken_tracks.py <track_id> [...]")
        print("   or: uv run scripts/simulate_broken_tracks.py --restore <track_id>")
        print("   or: uv run scripts/simulate_broken_tracks.py --artist-did <did>")
        print("   or: uv run scripts/simulate_broken_tracks.py --list")
        sys.exit(1)

    mode = sys.argv[1]

    if mode == "--list":
        await list_broken_tracks()
        return

    if mode == "--restore":
        if len(sys.argv) < 3:
            print("error: --restore requires a track id")
            sys.exit(1)
        try:
            track_id = int(sys.argv[2])
        except ValueError:
            print(f"error: invalid track id: {sys.argv[2]}")
            sys.exit(1)
        await restore_track(track_id)
        return

    if mode == "--artist-did":
        if len(sys.argv) < 3:
            print("error: --artist-did requires a DID")
            sys.exit(1)
        artist_did = sys.argv[2]
        await break_artist_tracks(artist_did)
        return

    # default: break specified tracks
    track_ids = []
    for arg in sys.argv[1:]:
        try:
            track_ids.append(int(arg))
        except ValueError:
            print(f"warning: skipping invalid track id: {arg}")

    if not track_ids:
        print("error: no valid track ids provided")
        sys.exit(1)

    for track_id in track_ids:
        await break_track(track_id)


if __name__ == "__main__":
    asyncio.run(main())
