#!/usr/bin/env python
"""admin script to manage feature flags for users.

usage (from repo root):
    cd backend && uv run python ../scripts/feature_flag.py enable --user <did_or_handle> --flag <flag_name>
    cd backend && uv run python ../scripts/feature_flag.py disable --user <did_or_handle> --flag <flag_name>
    cd backend && uv run python ../scripts/feature_flag.py list --user <did_or_handle>
    cd backend && uv run python ../scripts/feature_flag.py list-all

environment variables:
    DATABASE_URL - database connection string

examples:
    # enable lossless uploads for a user
    cd backend && DATABASE_URL="..." uv run python ../scripts/feature_flag.py enable --user did:plc:abc123 --flag lossless-uploads

    # disable a flag
    cd backend && DATABASE_URL="..." uv run python ../scripts/feature_flag.py disable --user zzstoatzz.io --flag lossless-uploads

    # list flags for a user
    cd backend && DATABASE_URL="..." uv run python ../scripts/feature_flag.py list --user zzstoatzz.io

    # list all users with flags
    cd backend && DATABASE_URL="..." uv run python ../scripts/feature_flag.py list-all
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

# add backend/src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "src"))


def get_database_url() -> str:
    """get database URL from environment."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("error: DATABASE_URL required")
        print("set DATABASE_URL to your database connection string")
        sys.exit(1)
    return url


async def resolve_user(db, did_or_handle: str):
    """resolve a DID or handle to an Artist record."""
    from sqlalchemy import select

    from backend.models import Artist

    # check if it's a DID
    if did_or_handle.startswith("did:"):
        result = await db.execute(select(Artist).where(Artist.did == did_or_handle))
    else:
        # treat as handle
        result = await db.execute(select(Artist).where(Artist.handle == did_or_handle))

    return result.scalar_one_or_none()


async def cmd_enable(args) -> None:
    """enable a feature flag for a user."""
    from backend._internal import enable_flag, get_user_flags
    from backend.utilities.database import db_session

    async with db_session() as db:
        artist = await resolve_user(db, args.user)
        if not artist:
            print(f"error: user not found: {args.user}")
            sys.exit(1)

        newly_enabled = await enable_flag(db, artist.did, args.flag)
        await db.commit()

        if newly_enabled:
            print(f"enabled '{args.flag}' for {artist.handle} ({artist.did})")
        else:
            print(f"flag '{args.flag}' already enabled for {artist.handle}")

        flags = await get_user_flags(db, artist.did)
        print(f"flags: {flags}")


async def cmd_disable(args) -> None:
    """disable a feature flag for a user."""
    from backend._internal import disable_flag, get_user_flags
    from backend.utilities.database import db_session

    async with db_session() as db:
        artist = await resolve_user(db, args.user)
        if not artist:
            print(f"error: user not found: {args.user}")
            sys.exit(1)

        was_disabled = await disable_flag(db, artist.did, args.flag)
        await db.commit()

        if was_disabled:
            print(f"disabled '{args.flag}' for {artist.handle} ({artist.did})")
        else:
            print(f"flag '{args.flag}' not enabled for {artist.handle}")

        flags = await get_user_flags(db, artist.did)
        print(f"flags: {flags}")


async def cmd_list(args) -> None:
    """list flags for a user."""
    from backend._internal import get_user_flags
    from backend.utilities.database import db_session

    async with db_session() as db:
        artist = await resolve_user(db, args.user)
        if not artist:
            print(f"error: user not found: {args.user}")
            sys.exit(1)

        flags = await get_user_flags(db, artist.did)
        print(f"{artist.handle} ({artist.did}):")
        if flags:
            for flag in flags:
                print(f"  - {flag}")
        else:
            print("  (no flags enabled)")


async def cmd_list_all(args) -> None:
    """list all users with feature flags."""
    from sqlalchemy import select

    from backend.models import Artist, FeatureFlag
    from backend.utilities.database import db_session

    async with db_session() as db:
        # find all unique user DIDs with flags
        result = await db.execute(select(FeatureFlag.user_did).distinct())
        dids_with_flags = list(result.scalars().all())

        if not dids_with_flags:
            print("no users have feature flags enabled")
            return

        # get artist info for each DID
        artist_result = await db.execute(
            select(Artist).where(Artist.did.in_(dids_with_flags))
        )
        artists_by_did = {a.did: a for a in artist_result.scalars().all()}

        # get all flags grouped by user
        flags_result = await db.execute(select(FeatureFlag))
        all_flags = flags_result.scalars().all()

        # group flags by DID
        flags_by_did: dict[str, list[str]] = {}
        for flag in all_flags:
            flags_by_did.setdefault(flag.user_did, []).append(flag.flag)

        print(f"users with feature flags ({len(dids_with_flags)}):")
        for did in dids_with_flags:
            artist = artists_by_did.get(did)
            handle = artist.handle if artist else "(unknown)"
            flags = flags_by_did.get(did, [])
            print(f"\n{handle} ({did}):")
            for flag in flags:
                print(f"  - {flag}")


def main() -> None:
    """main entry point."""
    parser = argparse.ArgumentParser(description="manage feature flags")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # enable command
    enable_parser = subparsers.add_parser("enable", help="enable a flag for a user")
    enable_parser.add_argument("--user", required=True, help="user DID or handle")
    enable_parser.add_argument(
        "--flag", required=True, help="flag name (e.g., lossless-uploads)"
    )

    # disable command
    disable_parser = subparsers.add_parser("disable", help="disable a flag for a user")
    disable_parser.add_argument("--user", required=True, help="user DID or handle")
    disable_parser.add_argument(
        "--flag", required=True, help="flag name (e.g., lossless-uploads)"
    )

    # list command
    list_parser = subparsers.add_parser("list", help="list flags for a user")
    list_parser.add_argument("--user", required=True, help="user DID or handle")

    # list-all command
    subparsers.add_parser("list-all", help="list all users with flags")

    args = parser.parse_args()

    # setup database URL
    os.environ["DATABASE_URL"] = get_database_url()

    # run command
    if args.command == "enable":
        asyncio.run(cmd_enable(args))
    elif args.command == "disable":
        asyncio.run(cmd_disable(args))
    elif args.command == "list":
        asyncio.run(cmd_list(args))
    elif args.command == "list-all":
        asyncio.run(cmd_list_all(args))


if __name__ == "__main__":
    main()
