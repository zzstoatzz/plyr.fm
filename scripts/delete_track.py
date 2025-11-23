#!/usr/bin/env -S uv run --script --quiet
"""admin script to delete a track and all associated data.

usage:
    uv run scripts/delete_track.py <track_id>
    uv run scripts/delete_track.py --url <track_url>

this will:
- delete audio file from R2
- delete cover image from R2 (if exists)
- delete ATProto record (if exists)
- delete track from database (cascades to likes, queue entries, etc.)

environment variables (use ADMIN_ prefix):
    ADMIN_DATABASE_URL - database connection string
    ADMIN_AWS_ACCESS_KEY_ID - R2 access key
    ADMIN_AWS_SECRET_ACCESS_KEY - R2 secret key
    ADMIN_R2_ENDPOINT_URL - R2 endpoint
    ADMIN_R2_BUCKET - R2 bucket name

example:
    export ADMIN_DATABASE_URL="postgresql+psycopg://..."
    export ADMIN_AWS_ACCESS_KEY_ID="..."
    export ADMIN_AWS_SECRET_ACCESS_KEY="..."
    export ADMIN_R2_ENDPOINT_URL="https://...r2.cloudflarestorage.com"
    export ADMIN_R2_BUCKET="audio-prod"
    uv run scripts/delete_track.py 34
"""

import asyncio
import sys
from pathlib import Path

# add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AdminSettings(BaseSettings):
    """settings for admin script with dedicated namespace."""

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = Field(validation_alias="ADMIN_DATABASE_URL")
    aws_access_key_id: str = Field(validation_alias="ADMIN_AWS_ACCESS_KEY_ID")
    aws_secret_access_key: str = Field(validation_alias="ADMIN_AWS_SECRET_ACCESS_KEY")
    r2_endpoint_url: str = Field(validation_alias="ADMIN_R2_ENDPOINT_URL")
    r2_bucket: str = Field(validation_alias="ADMIN_R2_BUCKET")


def setup_admin_env(admin_settings: AdminSettings) -> None:
    """setup environment variables from admin settings."""
    import os

    os.environ["DATABASE_URL"] = admin_settings.database_url
    os.environ["AWS_ACCESS_KEY_ID"] = admin_settings.aws_access_key_id
    os.environ["AWS_SECRET_ACCESS_KEY"] = admin_settings.aws_secret_access_key
    os.environ["R2_ENDPOINT_URL"] = admin_settings.r2_endpoint_url
    os.environ["R2_BUCKET"] = admin_settings.r2_bucket
    os.environ["R2_IMAGE_BUCKET"] = admin_settings.r2_bucket  # use same bucket
    os.environ["R2_PUBLIC_BUCKET_URL"] = ""  # not needed for deletion
    os.environ["R2_PUBLIC_IMAGE_BUCKET_URL"] = ""  # not needed for deletion


async def delete_track(track_id: int, dry_run: bool = False) -> None:
    """delete a track and all associated data."""
    # import backend modules AFTER env setup
    from sqlalchemy import select

    from backend.models import Track
    from backend.storage import storage
    from backend.utilities.database import db_session

    async with db_session() as db:
        # fetch track
        result = await db.execute(select(Track).where(Track.id == track_id))
        track = result.scalar_one_or_none()

        if not track:
            print(f"❌ track {track_id} not found")
            return

        print(f"\n{'[DRY RUN] ' if dry_run else ''}deleting track {track_id}:")
        print(f"  title: {track.title}")
        print(f"  artist: {track.artist_did}")
        print(f"  file_id: {track.file_id}")
        print(f"  image_id: {track.image_id}")
        print(f"  atproto_uri: {track.atproto_record_uri}")

        if dry_run:
            print("\n🔍 dry run - no changes made")
            print("\nwould delete:")
            print(f"  - audio file: {track.file_id}")
            if track.image_id:
                print(f"  - image file: {track.image_id}")
            if track.atproto_record_uri:
                print(f"  - atproto record: {track.atproto_record_uri}")
            print(f"  - database record: track {track_id}")
            return

        # 1. delete audio file from R2
        print(f"\n🗑️  deleting audio file: {track.file_id}")
        try:
            storage.delete(track.file_id)
            print("   ✅ audio file deleted")
        except Exception as e:
            print(f"   ⚠️  failed to delete audio file: {e}")

        # 2. delete image file from R2 (if exists)
        if track.image_id:
            print(f"🗑️  deleting image file: {track.image_id}")
            try:
                storage.delete(track.image_id)
                print("   ✅ image file deleted")
            except Exception as e:
                print(f"   ⚠️  failed to delete image file: {e}")

        # 3. delete ATProto record (if exists)
        if track.atproto_record_uri:
            print(f"🗑️  deleting atproto record: {track.atproto_record_uri}")
            try:
                # need to get artist's session for this
                # for now, just note that it needs manual cleanup
                print(
                    "   ⚠️  atproto record requires manual cleanup (needs artist auth)"
                )
                print(f"      uri: {track.atproto_record_uri}")
            except Exception as e:
                print(f"   ⚠️  failed to delete atproto record: {e}")

        # 4. delete from database (cascades to likes, queue entries, etc.)
        print(f"🗑️  deleting database record: track {track_id}")
        await db.delete(track)
        await db.commit()
        print("   ✅ database record deleted (cascaded to related records)")

        print(f"\n✅ track {track_id} deleted successfully")


async def main() -> None:
    """main entry point."""
    if len(sys.argv) < 2:
        print("usage: uv run scripts/delete_track.py <track_id>")
        print("   or: uv run scripts/delete_track.py --url <track_url>")
        print("  add --dry-run to see what would be deleted without making changes")
        sys.exit(1)

    # load admin settings BEFORE any backend imports
    try:
        admin_settings = AdminSettings()
        print(
            f"✓ loaded admin settings for database: {admin_settings.database_url.split('@')[1].split('/')[0]}"
        )
    except Exception as e:
        print(f"❌ failed to load admin settings: {e}")
        print("\nrequired environment variables:")
        print("  ADMIN_DATABASE_URL")
        print("  ADMIN_AWS_ACCESS_KEY_ID")
        print("  ADMIN_AWS_SECRET_ACCESS_KEY")
        print("  ADMIN_R2_ENDPOINT_URL")
        print("  ADMIN_R2_BUCKET")
        sys.exit(1)

    # setup environment BEFORE any backend imports
    setup_admin_env(admin_settings)

    dry_run = "--dry-run" in sys.argv
    if dry_run:
        sys.argv.remove("--dry-run")

    skip_confirm = "--yes" in sys.argv or "-y" in sys.argv
    if "--yes" in sys.argv:
        sys.argv.remove("--yes")
    if "-y" in sys.argv:
        sys.argv.remove("-y")

    # handle --url flag
    if sys.argv[1] == "--url":
        if len(sys.argv) < 3:
            print("error: --url requires a URL argument")
            sys.exit(1)
        url = sys.argv[2]
        # extract track id from URL like https://plyr.fm/track/34
        try:
            track_id = int(url.rstrip("/").split("/")[-1])
        except (ValueError, IndexError):
            print(f"error: could not extract track id from URL: {url}")
            sys.exit(1)
    else:
        try:
            track_id = int(sys.argv[1])
        except ValueError:
            print(f"error: invalid track id: {sys.argv[1]}")
            sys.exit(1)

    # confirm deletion
    if not dry_run and not skip_confirm:
        print(f"\n⚠️  you are about to DELETE track {track_id}")
        print("this will:")
        print("  - delete the audio file from R2")
        print("  - delete the cover image from R2 (if exists)")
        print("  - delete the database record")
        print("  - cascade delete likes and queue entries")
        print("\nthis CANNOT be undone!")
        confirm = input("\ntype 'yes' to confirm: ")
        if confirm.lower() != "yes":
            print("❌ deletion cancelled")
            return

    await delete_track(track_id, dry_run=dry_run)


if __name__ == "__main__":
    asyncio.run(main())
