#!/usr/bin/env python
"""publish the community.lexicon.app.profile record for plyr.fm.

this is the community lexicon's app record: a self-published description of the
app (name, icon, links, which lexicons it produces and consumes) that app
directories and stores read. it is keyed `self` in our own repo.

the icon is uploaded as an atproto blob so the record does not depend on a URL
we might later reshuffle.

usage:
    uv run --project backend scripts/publish_app_profile.py --dry-run
    uv run --project backend scripts/publish_app_profile.py

verify afterwards:
    https://brand.waow.tech/xrpc/tech.waow.brand.getBrand?namespace=fm.plyr.track
"""

import argparse
import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from atproto import AsyncClient
from atproto_client.exceptions import BadRequestError
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).parent.parent
ICON = ROOT / "frontend" / "static" / "icons" / "icon-512.png"
COLLECTION = "community.lexicon.app.profile"
DEFS = "community.lexicon.app.defs"
MAX_IMAGE_BYTES = 2_000_000

PRODUCES = (
    "fm.plyr.track",
    "fm.plyr.like",
    "fm.plyr.list",
    "fm.plyr.comment",
    "fm.plyr.actor.profile",
    "fm.teal.alpha.feed.play",
    "fm.teal.alpha.actor.status",
)
CONSUMES = ("app.bsky.actor.profile",)

LINKS = (
    ("https://plyr.fm", "linkRoleWebsite", "Website"),
    ("https://docs.plyr.fm", "linkRoleDocs", "Docs"),
    ("https://github.com/zzstoatzz/plyr.fm", "linkRoleSourceCode", "Source"),
    ("https://plyr.fm/manifest.webmanifest", "linkRoleWebManifest", "Web manifest"),
    ("https://plyr.fm/privacy", "linkRolePrivacyPolicy", "Privacy"),
    ("https://plyr.fm/terms", "linkRoleTermsOfService", "Terms"),
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT / ".env"), extra="ignore")

    plyrfm_handle: str = Field(default="plyr.fm", validation_alias="PLYRFM_HANDLE")
    plyrfm_password: str = Field(validation_alias="PLYRFM_PASSWORD")


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def build_record(icon: dict[str, Any], created_at: str) -> dict[str, Any]:
    return {
        "$type": COLLECTION,
        "name": "plyr.fm",
        "description": "audio on atproto — your music lives in your PDS, playable by any client.",
        "status": f"{DEFS}#released",
        "tags": ["music", "audio", "streaming", "radio"],
        "platforms": [f"{DEFS}#platformWeb"],
        "links": [
            {"uri": uri, "role": f"{DEFS}#{role}", "label": label}
            for uri, role, label in LINKS
        ],
        "images": [
            {
                "alt": "the plyr.fm app icon",
                "purpose": f"{DEFS}#purposeIcon",
                "image": icon,
            }
        ],
        "lexicons": {"produces": list(PRODUCES), "consumes": list(CONSUMES)},
        "accountIndicators": [{"collection": "fm.plyr.actor.profile", "rkey": "self"}],
        "createdAt": created_at,
    }


async def existing_created_at(client: AsyncClient) -> str | None:
    """reuse the createdAt of an already-published record so reruns are stable."""
    try:
        record = await client.com.atproto.repo.get_record(
            {"repo": client.me.did, "collection": COLLECTION, "rkey": "self"}
        )
    except BadRequestError:
        return None
    return getattr(record.value, "created_at", None)


async def main(dry_run: bool) -> None:
    settings = Settings()

    data = ICON.read_bytes()
    if len(data) > MAX_IMAGE_BYTES:
        raise SystemExit(
            f"{ICON.name} is {len(data)}b, over the {MAX_IMAGE_BYTES}b lexicon cap"
        )

    client = AsyncClient()
    await client.login(settings.plyrfm_handle, settings.plyrfm_password)
    print(f"authenticated as {settings.plyrfm_handle} ({client.me.did})")

    created_at = await existing_created_at(client)
    print(f"createdAt: {created_at or 'new record, stamping now'}")

    if dry_run:
        placeholder = {
            "$type": "blob",
            "ref": {"$link": "<uploaded on publish>"},
            "mimeType": "image/png",
            "size": len(data),
        }
        print(json.dumps(build_record(placeholder, created_at or "<now>"), indent=2))
        return

    uploaded = (await client.com.atproto.repo.upload_blob(data)).blob
    icon = {
        "$type": "blob",
        "ref": {"$link": uploaded.ref.link},
        "mimeType": uploaded.mime_type,
        "size": uploaded.size,
    }
    print(
        f"uploaded icon blob {uploaded.ref.link} ({uploaded.size}b, {uploaded.mime_type})"
    )

    result = await client.com.atproto.repo.put_record(
        {
            "repo": client.me.did,
            "collection": COLLECTION,
            "rkey": "self",
            "record": build_record(icon, created_at or _now_iso()),
        }
    )
    print(f"published {COLLECTION}: {result.uri} (cid {result.cid})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="print the record without writing"
    )
    asyncio.run(main(parser.parse_args().dry_run))
