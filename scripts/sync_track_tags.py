"""Refresh indexed tags from PDS records; optionally migrate legacy tags with a session."""

import argparse
import asyncio
import os

from sqlalchemy import select

from backend._internal.atproto.tag_sync import sync_track_tags
from backend._internal.auth import get_session
from backend.models import Track
from backend.utilities.database import db_session


async def run(
    artist_did: str | None, track_id: int | None, session_id: str | None
) -> None:
    auth_session = await get_session(session_id) if session_id else None
    if session_id and not auth_session:
        raise ValueError("session is unavailable")
    async with db_session() as db:
        query = select(Track.id).where(
            Track.atproto_record_uri.isnot(None), Track.is_private.is_(False)
        )
        if artist_did:
            query = query.where(Track.artist_did == artist_did)
        if track_id:
            query = query.where(Track.id == track_id)
        if auth_session:
            query = query.where(Track.artist_did == auth_session.did)
        ids = list(await db.scalars(query))
    for identifier in ids:
        await sync_track_tags(identifier, auth_session)
        print(f"reconciled track {identifier}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--artist-did")
    scope.add_argument("--track-id", type=int)
    parser.add_argument(
        "--write-with-session",
        action="store_true",
        help="read the owner's session from PLYR_TAG_SYNC_SESSION",
    )
    args = parser.parse_args()
    session_id = (
        os.environ["PLYR_TAG_SYNC_SESSION"] if args.write_with_session else None
    )
    asyncio.run(run(args.artist_did, args.track_id, session_id))
