#!/usr/bin/env python
"""publish permission set lexicon to ATProto repo with specific rkey."""

import asyncio
import os

from atproto import AsyncClient


async def main():
    handle = os.environ["PLYRFM_HANDLE"]
    password = os.environ["PLYRFM_PASSWORD"]
    namespace = os.environ.get("NAMESPACE", "fm.plyr")

    client = AsyncClient()
    await client.login(handle, password)

    permission_set_id = f"{namespace}.authFullApp"

    record = {
        "$type": "com.atproto.lexicon.schema",
        "lexicon": 1,
        "id": permission_set_id,
        "defs": {
            "main": {
                "type": "permission-set",
                "title": "plyr.fm",
                "description": "Upload and manage audio content, playlists, likes, and comments.",
                "permissions": [
                    {
                        "type": "permission",
                        "resource": "repo",
                        "action": ["create", "update", "delete"],
                        "collection": [
                            f"{namespace}.track",
                            f"{namespace}.like",
                            f"{namespace}.comment",
                            f"{namespace}.list",
                            f"{namespace}.actor.profile",
                        ],
                    }
                ],
            }
        },
    }

    result = await client.com.atproto.repo.put_record(
        {
            "repo": client.me.did,
            "collection": "com.atproto.lexicon.schema",
            "rkey": permission_set_id,
            "record": record,
        }
    )

    print(f"created: {result.uri}")
    print(f"cid: {result.cid}")


if __name__ == "__main__":
    asyncio.run(main())
