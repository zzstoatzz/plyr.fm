#!/usr/bin/env python
"""publish permission set lexicon to ATProto repo with specific rkey."""

import asyncio
from pathlib import Path

from atproto import AsyncClient
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT / ".env"), extra="ignore")

    plyrfm_handle: str = Field(validation_alias="PLYRFM_HANDLE")
    plyrfm_password: str = Field(validation_alias="PLYRFM_PASSWORD")
    namespace: str = Field(default="fm.plyr", validation_alias="NAMESPACE")


async def main():
    settings = Settings()

    client = AsyncClient()
    await client.login(settings.plyrfm_handle, settings.plyrfm_password)

    permission_set_id = f"{settings.namespace}.authFullApp"

    record = {
        "$type": "com.atproto.lexicon.schema",
        "lexicon": 1,
        "id": permission_set_id,
        "defs": {
            "main": {
                "type": "permission-set",
                "title": "Full plyr.fm Access",
                "detail": "Provides full access to all plyr.fm features including uploading and managing tracks, playlists, likes, and comments.",
                "permissions": [
                    {
                        "type": "permission",
                        "resource": "repo",
                        "action": ["create", "update", "delete"],
                        "collection": [
                            f"{settings.namespace}.track",
                            f"{settings.namespace}.like",
                            f"{settings.namespace}.comment",
                            f"{settings.namespace}.list",
                            f"{settings.namespace}.actor.profile",
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
