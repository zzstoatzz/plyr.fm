#!/usr/bin/env -S uv run --script --quiet
"""backfill ATProto records for tracks missing atproto_record_uri.

Creates ATProto records on user's PDS for tracks that:
1. Exist in the database
2. Have no atproto_record_uri (orphaned/never synced)
3. Belong to the configured user (ATPROTO_MAIN_HANDLE)

The script uses the app's namespace configuration (settings.atproto.track_collection)
to create records in the correct namespace for the current environment.

## Prerequisites

Set credentials in .env:
```bash
ATPROTO_MAIN_HANDLE=your.handle
ATPROTO_MAIN_PASSWORD=your-app-password
DATABASE_URL=postgresql://...  # target database
```

## Usage

```bash
uv run scripts/backfill_atproto_records.py
```

The script will:
1. Resolve user's PDS URL from handle/DID
2. Query database for tracks without atproto_record_uri
3. Create ATProto records on PDS using configured namespace
4. Update database with new URIs and CIDs

## Verification

After running, verify success:
```bash
# check ATProto records on PDS (see docs/tools/pdsx.md)
uvx pdsx --pds <pds-url> -r <handle> ls <namespace>

# check database (see docs/tools/neon.md)
SELECT COUNT(*) FROM tracks WHERE atproto_record_uri IS NOT NULL;
```

## References

- Database queries: docs/tools/neon.md
- PDS inspection: docs/tools/pdsx.md
- ATProto records: src/backend/_internal/atproto/records.py
"""

import asyncio
from datetime import UTC, datetime

from atproto import AsyncClient
from atproto_identity.resolver import AsyncIdResolver
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import select

from backend.config import settings as app_settings
from backend.models import Artist, Track, db_session


class BackfillSettings(BaseSettings):
    """settings for backfill script."""

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    handle: str = Field(validation_alias="ATPROTO_MAIN_HANDLE")
    password: str = Field(validation_alias="ATPROTO_MAIN_PASSWORD")


async def main():
    """backfill ATProto records for orphaned tracks."""
    settings = BackfillSettings()

    # resolve PDS from handle
    print(f"resolving PDS for {settings.handle}...")
    resolver = AsyncIdResolver()

    # first resolve handle to DID
    user_did = await resolver.handle.resolve(settings.handle)
    print(f"resolved DID: {user_did}")

    # then get PDS URL from DID document
    did_doc = await resolver.did.resolve(user_did)
    pds_url = None
    for service in did_doc.service:
        if service.type == "AtprotoPersonalDataServer":
            pds_url = service.service_endpoint
            break

    if not pds_url:
        raise ValueError(f"no PDS found for {settings.handle}")

    print(f"using PDS: {pds_url}")

    # create atproto client with correct PDS
    client = AsyncClient(base_url=pds_url)
    await client.login(settings.handle, settings.password)

    print(f"logged in as {settings.handle} (DID: {user_did})")

    # fetch tracks that need backfilling
    async with db_session() as db:
        stmt = (
            select(Track)
            .join(Artist)
            .where(Track.artist_did == user_did)
            .where(Track.atproto_record_uri.is_(None))
            .order_by(Track.id)
        )
        result = await db.execute(stmt)
        tracks = result.scalars().all()

        # eagerly load artist for each track
        for track in tracks:
            await db.refresh(track, ["artist"])

    print(f"found {len(tracks)} tracks to backfill")

    if not tracks:
        print("no tracks need backfilling!")
        return

    # backfill each track
    for track in tracks:
        print(f"\nbackfilling track {track.id}: {track.title}")

        # build record
        record = {
            "$type": app_settings.atproto.track_collection,
            "title": track.title,
            "artist": track.artist.display_name,
            "audioUrl": track.r2_url,
            "fileType": track.file_type,
            "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }

        # add optional fields
        if track.album:
            record["album"] = track.album

        if track.features:
            # convert to ATProto format
            record["features"] = [
                {
                    "did": f["did"],
                    "handle": f["handle"],
                    "displayName": f.get("display_name", f["handle"]),
                }
                for f in track.features
            ]

        if track.image_id:
            # manually construct image URL since images table doesn't exist in prod
            # try common image formats - in practice these are likely jpg/png
            r2_public_url = "https://pub-d4ed8a1e39d44dac85263d86ad5676fd.r2.dev"
            # assume jpg for now - can be updated later if needed
            record["imageUrl"] = f"{r2_public_url}/images/{track.image_id}.jpg"

        # create record
        try:
            response = await client.com.atproto.repo.create_record(
                {
                    "repo": user_did,
                    "collection": app_settings.atproto.track_collection,
                    "record": record,
                }
            )

            record_uri = response.uri
            record_cid = response.cid

            print(f"  ✓ created record: {record_uri}")

            # update database
            async with db_session() as db:
                stmt = select(Track).where(Track.id == track.id)
                result = await db.execute(stmt)
                db_track = result.scalar_one()

                db_track.atproto_record_uri = record_uri
                db_track.atproto_record_cid = record_cid

                await db.commit()

            print("  ✓ updated database")

        except Exception as e:
            print(f"  ✗ failed: {e}")
            continue

    print(f"\nbackfilled {len(tracks)} tracks successfully!")


if __name__ == "__main__":
    asyncio.run(main())
