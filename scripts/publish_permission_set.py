#!/usr/bin/env python
"""publish permission set lexicons from lexicons/ to the plyr.fm ATProto repo.

usage: uv run scripts/publish_permission_set.py authFullApp [privateMedia]

publishes to the namespace in NAMESPACE (default: fm.plyr, i.e. production).
for staging: NAMESPACE=fm.plyr.stg uv run scripts/publish_permission_set.py ...
"""

import argparse
import asyncio
import json
from pathlib import Path
from typing import Any

from atproto import AsyncClient
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).parent.parent
LEXICON_DIR = ROOT / "lexicons"
PROD_NAMESPACE = "fm.plyr"
PERMISSION_SETS = ("authFullApp", "privateMedia")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT / ".env"), extra="ignore")

    plyrfm_handle: str = Field(default="plyr.fm", validation_alias="PLYRFM_HANDLE")
    plyrfm_password: str = Field(validation_alias="PLYRFM_PASSWORD")
    namespace: str = Field(default=PROD_NAMESPACE, validation_alias="NAMESPACE")


def _renamespace(value: Any, ns: str) -> Any:
    if isinstance(value, str):
        return value.replace(f"{PROD_NAMESPACE}.", f"{ns}.")
    if isinstance(value, list):
        return [_renamespace(item, ns) for item in value]
    if isinstance(value, dict):
        return {key: _renamespace(item, ns) for key, item in value.items()}
    return value


async def _publish(client: AsyncClient, name: str, ns: str) -> None:
    schema = _renamespace(json.loads((LEXICON_DIR / f"{name}.json").read_text()), ns)
    result = await client.com.atproto.repo.put_record(
        {
            "repo": client.me.did,
            "collection": "com.atproto.lexicon.schema",
            "rkey": schema["id"],
            "record": {"$type": "com.atproto.lexicon.schema", **schema},
        }
    )
    print(f"published {schema['id']}: {result.uri} (cid {result.cid})")


async def main(names: list[str]) -> None:
    settings = Settings()

    client = AsyncClient()
    await client.login(settings.plyrfm_handle, settings.plyrfm_password)

    for name in names:
        await _publish(client, name, settings.namespace)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sets", nargs="+", choices=PERMISSION_SETS)
    asyncio.run(main(parser.parse_args().sets))
