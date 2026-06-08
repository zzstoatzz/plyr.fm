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


def _auth_full_app(ns: str) -> dict:
    return {
        "type": "permission-set",
        "title": "Full plyr.fm Access",
        "detail": "Provides full access to all plyr.fm features including uploading and managing tracks, playlists, likes, and comments.",
        "permissions": [
            {
                "type": "permission",
                "resource": "repo",
                "action": ["create", "update", "delete"],
                "collection": [
                    f"{ns}.track",
                    f"{ns}.like",
                    f"{ns}.comment",
                    f"{ns}.list",
                    f"{ns}.actor.profile",
                ],
            }
        ],
    }


def _private_media(ns: str) -> dict:
    """permissioned-space set for artist-owned private media (#1528).

    requested progressively as `include:{ns}.privateMedia` only for accounts on a
    PDS that supports permissioned spaces; the PDS expands the space permission
    into `space:{ns}.privateMedia?action=...` scopes on the token.
    """
    return {
        "type": "permission-set",
        "title": "plyr.fm Private Media",
        "detail": "Access to your private audio — a permissioned space on your PDS that only you (and apps you grant) can read.",
        "permissions": [
            {
                "type": "permission",
                "resource": "space",
                "action": ["read", "create", "update", "delete", "manage"],
                "space": [f"{ns}.privateMedia"],
                "skey": ["self"],
                "did": ["*"],
                "collection": [f"{ns}.track"],
            }
        ],
    }


async def _publish(client: AsyncClient, permission_set_id: str, main_def: dict) -> None:
    record = {
        "$type": "com.atproto.lexicon.schema",
        "lexicon": 1,
        "id": permission_set_id,
        "defs": {"main": main_def},
    }
    result = await client.com.atproto.repo.put_record(
        {
            "repo": client.me.did,
            "collection": "com.atproto.lexicon.schema",
            "rkey": permission_set_id,
            "record": record,
        }
    )
    print(f"published {permission_set_id}: {result.uri} (cid {result.cid})")


async def main():
    settings = Settings()

    client = AsyncClient()
    await client.login(settings.plyrfm_handle, settings.plyrfm_password)

    ns = settings.namespace
    await _publish(client, f"{ns}.authFullApp", _auth_full_app(ns))
    await _publish(client, f"{ns}.privateMedia", _private_media(ns))


if __name__ == "__main__":
    asyncio.run(main())
