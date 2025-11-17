#!/usr/bin/env -S uv run --script --quiet
"""migrate ATProto records from production namespace to environment-specific namespace.

This script migrates tracks and likes from the production `fm.plyr.*` namespace
to an environment-specific namespace (e.g., `fm.plyr.stg.*` for staging).

IMPORTANT: This script does NOT delete records from the production namespace.
Deletion must be done manually after verifying the migration succeeded.

## Prerequisites

Set credentials in .env:
```bash
ATPROTO_MAIN_HANDLE=your.handle
ATPROTO_MAIN_PASSWORD=your-app-password
DATABASE_URL=postgresql://...  # target database (staging)
```

## Usage

```bash
# dry run (default) - shows what would happen without making changes
uv run scripts/migrate_atproto_namespace.py --target-namespace fm.plyr.stg

# actually perform migration
uv run scripts/migrate_atproto_namespace.py --target-namespace fm.plyr.stg --execute

# verify migration
uvx pdsx --pds <pds-url> -r <handle> ls fm.plyr.stg.track
uvx pdsx --pds <pds-url> -r <handle> ls fm.plyr.stg.like
```

## What it does

1. **Migrate tracks:**
   - Find tracks in DB with URIs in production namespace (`fm.plyr.track`)
   - Read existing record from PDS
   - Create new record in target namespace (e.g., `fm.plyr.stg.track`)
   - Update database with new URI/CID
   - Build mapping: old track URI → new track URI

2. **Migrate likes:**
   - Find likes in DB with URIs in production namespace (`fm.plyr.like`)
   - Read existing like record from PDS
   - Look up new track URI from mapping built in step 1
   - Create new like record in target namespace with updated subject reference
   - Update database with new like URI/CID

## References

- Database queries: docs/tools/neon.md
- PDS inspection: docs/tools/pdsx.md
- Issue tracker: https://github.com/zzstoatzz/plyr.fm/issues/262
"""

import asyncio
from datetime import UTC, datetime

import typer
from atproto import AsyncClient
from atproto_identity.resolver import AsyncIdResolver
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import select

from backend.models import Track, TrackLike, db_session

app = typer.Typer()


class MigrationSettings(BaseSettings):
    """settings for migration script."""

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    main_handle: str = Field(validation_alias="ATPROTO_MAIN_HANDLE")
    main_password: str = Field(validation_alias="ATPROTO_MAIN_PASSWORD")
    devlog_handle: str = Field(validation_alias="NOTIFY_BOT_HANDLE")
    devlog_password: str = Field(validation_alias="NOTIFY_BOT_PASSWORD")


async def resolve_pds_url(handle: str) -> tuple[str, str]:
    """resolve PDS URL and DID from handle.

    returns:
        tuple of (did, pds_url)
    """
    resolver = AsyncIdResolver()

    # resolve handle to DID
    user_did = await resolver.handle.resolve(handle)

    # get PDS URL from DID document
    did_doc = await resolver.did.resolve(user_did)
    pds_url = None
    for service in did_doc.service:
        if service.type == "AtprotoPersonalDataServer":
            pds_url = service.service_endpoint
            break

    if not pds_url:
        raise ValueError(f"no PDS found for {handle}")

    return user_did, pds_url


async def migrate_tracks(
    client: AsyncClient,
    user_did: str,
    source_namespace: str,
    target_namespace: str,
    dry_run: bool,
) -> dict[str, str]:
    """migrate tracks from source to target namespace.

    returns:
        mapping of old track URI → new track URI
    """
    typer.echo(f"\n{'[DRY RUN] ' if dry_run else ''}Migrating tracks...")
    typer.echo(f"  Source: {source_namespace}.track")
    typer.echo(f"  Target: {target_namespace}.track")

    # find tracks in DB with URIs in source namespace
    async with db_session() as db:
        stmt = (
            select(Track)
            .where(Track.artist_did == user_did)
            .where(Track.atproto_record_uri.like(f"%{source_namespace}.track%"))
            .order_by(Track.id)
        )
        result = await db.execute(stmt)
        tracks = result.scalars().all()

    typer.echo(f"  Found {len(tracks)} tracks to migrate")

    if len(tracks) == 0:
        return {}

    uri_mapping = {}

    for track in tracks:
        old_uri = track.atproto_record_uri

        typer.echo(f"\n  Track #{track.id}: {track.title}")
        typer.echo(f"    Old URI: {old_uri}")

        if dry_run:
            typer.echo(
                f"    [DRY RUN] Would read record and create in {target_namespace}.track"
            )
            # in dry run, create fake mapping for likes step
            uri_mapping[old_uri] = f"at://{user_did}/{target_namespace}.track/DRYRUN"
            continue

        # read existing record from PDS
        response = await client.com.atproto.repo.get_record(
            {
                "repo": user_did,
                "collection": f"{source_namespace}.track",
                "rkey": old_uri.split("/")[-1],
            }
        )

        old_record = response.value

        # create new record in target namespace
        new_record = {
            **old_record,
            "$type": f"{target_namespace}.track",
        }

        create_response = await client.com.atproto.repo.create_record(
            {
                "repo": user_did,
                "collection": f"{target_namespace}.track",
                "record": new_record,
            }
        )

        new_uri = create_response.uri
        new_cid = create_response.cid

        typer.echo(f"    New URI: {new_uri}")

        # update database
        async with db_session() as db:
            stmt = select(Track).where(Track.id == track.id)
            result = await db.execute(stmt)
            db_track = result.scalar_one()

            db_track.atproto_record_uri = new_uri
            db_track.atproto_record_cid = new_cid

            await db.commit()

        typer.echo("    ✓ Migrated and updated database")

        # save mapping for likes
        uri_mapping[old_uri] = new_uri

    return uri_mapping


async def migrate_likes(
    client: AsyncClient,
    user_did: str,
    source_namespace: str,
    target_namespace: str,
    track_uri_mapping: dict[str, str],
    dry_run: bool,
) -> None:
    """migrate likes from source to target namespace."""
    typer.echo(f"\n{'[DRY RUN] ' if dry_run else ''}Migrating likes...")
    typer.echo(f"  Source: {source_namespace}.like")
    typer.echo(f"  Target: {target_namespace}.like")

    # find likes in DB with URIs in source namespace
    async with db_session() as db:
        stmt = (
            select(TrackLike)
            .where(TrackLike.user_did == user_did)
            .where(TrackLike.atproto_like_uri.like(f"%{source_namespace}.like%"))
            .order_by(TrackLike.id)
        )
        result = await db.execute(stmt)
        likes = result.scalars().all()

    typer.echo(f"  Found {len(likes)} likes to migrate")

    if len(likes) == 0:
        return

    for like in likes:
        old_uri = like.atproto_like_uri

        typer.echo(f"\n  Like #{like.id} for track #{like.track_id}")
        typer.echo(f"    Old URI: {old_uri}")

        if dry_run:
            typer.echo(
                f"    [DRY RUN] Would read record, map subject URI, and create in {target_namespace}.like"
            )
            continue

        # read existing like record from PDS
        response = await client.com.atproto.repo.get_record(
            {
                "repo": user_did,
                "collection": f"{source_namespace}.like",
                "rkey": old_uri.split("/")[-1],
            }
        )

        old_like_record = response.value
        old_subject_uri = old_like_record["subject"]["uri"]

        # look up new track URI from mapping
        if old_subject_uri not in track_uri_mapping:
            typer.echo(
                f"    ✗ ERROR: No mapping found for subject URI: {old_subject_uri}"
            )
            typer.echo("    Skipping this like")
            continue

        new_subject_uri = track_uri_mapping[old_subject_uri]

        # get new track CID by reading the new track record
        track_rkey = new_subject_uri.split("/")[-1]
        track_response = await client.com.atproto.repo.get_record(
            {
                "repo": user_did,
                "collection": f"{target_namespace}.track",
                "rkey": track_rkey,
            }
        )
        new_subject_cid = track_response.cid

        # create new like record with updated subject
        new_like_record = {
            "$type": f"{target_namespace}.like",
            "subject": {
                "uri": new_subject_uri,
                "cid": new_subject_cid,
            },
            "createdAt": old_like_record.get(
                "createdAt", datetime.now(UTC).isoformat().replace("+00:00", "Z")
            ),
        }

        create_response = await client.com.atproto.repo.create_record(
            {
                "repo": user_did,
                "collection": f"{target_namespace}.like",
                "record": new_like_record,
            }
        )

        new_like_uri = create_response.uri

        typer.echo(f"    Subject: {old_subject_uri} → {new_subject_uri}")
        typer.echo(f"    New URI: {new_like_uri}")

        # update database
        async with db_session() as db:
            stmt = select(TrackLike).where(TrackLike.id == like.id)
            result = await db.execute(stmt)
            db_like = result.scalar_one()

            db_like.atproto_like_uri = new_like_uri

            await db.commit()

        typer.echo("    ✓ Migrated and updated database")


@app.command()
def main(
    target_namespace: str = typer.Option(
        ...,
        "--target-namespace",
        help="Target namespace (e.g., 'fm.plyr.stg' for staging)",
    ),
    execute: bool = typer.Option(
        False,
        "--execute",
        help="Actually perform migration (default is dry-run)",
    ),
    source_namespace: str = typer.Option(
        "fm.plyr",
        "--source-namespace",
        help="Source namespace (production)",
    ),
):
    """migrate ATProto records from production namespace to environment-specific namespace."""

    async def run_migration():
        settings = MigrationSettings()

        dry_run = not execute

        if dry_run:
            typer.echo("=" * 60)
            typer.echo("DRY RUN MODE - No changes will be made")
            typer.echo("=" * 60)
        else:
            typer.echo("=" * 60)
            typer.echo("EXECUTING MIGRATION")
            typer.echo("=" * 60)
            typer.confirm("Are you sure you want to proceed?", abort=True)

        # set up both users
        users = [
            {
                "handle": settings.main_handle,
                "password": settings.main_password,
                "name": "main",
            },
            {
                "handle": settings.devlog_handle,
                "password": settings.devlog_password,
                "name": "devlog",
            },
        ]

        # resolve and authenticate both users
        authenticated_users = []
        for user in users:
            typer.echo(f"\nResolving PDS for {user['handle']} ({user['name']})...")
            user_did, pds_url = await resolve_pds_url(user["handle"])
            typer.echo(f"  DID: {user_did}")
            typer.echo(f"  PDS: {pds_url}")

            # authenticate
            client = AsyncClient(base_url=pds_url)
            await client.login(user["handle"], user["password"])
            typer.echo("  ✓ Authenticated")

            authenticated_users.append(
                {
                    **user,
                    "did": user_did,
                    "pds_url": pds_url,
                    "client": client,
                }
            )

        # migrate ALL tracks first (builds complete URI mapping)
        track_uri_mapping = {}
        for user in authenticated_users:
            typer.echo(
                f"\n{'=' * 60}\nProcessing tracks for {user['handle']} ({user['name']})\n{'=' * 60}"
            )
            mapping = await migrate_tracks(
                client=user["client"],
                user_did=user["did"],
                source_namespace=source_namespace,
                target_namespace=target_namespace,
                dry_run=dry_run,
            )
            track_uri_mapping.update(mapping)

        # migrate ALL likes (uses complete URI mapping from all users)
        for user in authenticated_users:
            typer.echo(
                f"\n{'=' * 60}\nProcessing likes for {user['handle']} ({user['name']})\n{'=' * 60}"
            )
            await migrate_likes(
                client=user["client"],
                user_did=user["did"],
                source_namespace=source_namespace,
                target_namespace=target_namespace,
                track_uri_mapping=track_uri_mapping,
                dry_run=dry_run,
            )

        typer.echo("\n" + "=" * 60)
        if dry_run:
            typer.echo("DRY RUN COMPLETE")
            typer.echo("Run with --execute to perform actual migration")
        else:
            typer.echo("MIGRATION COMPLETE")
            typer.echo("\nIMPORTANT: Old records still exist in production namespace.")
            typer.echo("After verifying migration, manually delete old records.")
        typer.echo("=" * 60)

    asyncio.run(run_migration())


if __name__ == "__main__":
    app()
