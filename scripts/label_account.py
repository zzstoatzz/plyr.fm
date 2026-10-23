#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx",
#     "pydantic-settings",
# ]
# ///
"""label (or unlabel) an account from the plyr.fm labeler.

an account label's subject is the bare DID, so it applies in every environment
— one labeler serves staging and production. see
docs/internal/moderation/label-policy.md.

usage:
    uv run scripts/label_account.py --handle penny.hailey.at --actor zzstoatzz.io \\
        --reason "bio: ai agent on atproto" --dry-run
    uv run scripts/label_account.py --did did:plc:... --actor zzstoatzz.io \\
        --reason "..." --negate

environment variables (set in .env or export):
    MODERATION_SERVICE_URL - moderation service (default: https://moderation.plyr.fm)
    MODERATION_AUTH_TOKEN - auth token for moderation service
"""

import argparse
import asyncio
import json
import sys

import httpx
from _moderation import DEFAULT_SERVICE_URL, ModerationClient
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ACCOUNT_LABEL_VALUES = ("ai",)
RESOLVE_HANDLE_URL = (
    "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle"
)


class LabelAccountSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", case_sensitive=False, extra="ignore"
    )

    moderation_service_url: str = Field(
        default=DEFAULT_SERVICE_URL, validation_alias="MODERATION_SERVICE_URL"
    )
    moderation_auth_token: str = Field(
        default="", validation_alias="MODERATION_AUTH_TOKEN"
    )


async def resolve_did(handle: str) -> str:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(RESOLVE_HANDLE_URL, params={"handle": handle})
        response.raise_for_status()
        return response.json()["did"]


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    subject = parser.add_mutually_exclusive_group(required=True)
    subject.add_argument("--handle")
    subject.add_argument("--did")
    parser.add_argument("--val", default="ai", choices=ACCOUNT_LABEL_VALUES)
    parser.add_argument("--actor", required=True)
    parser.add_argument("--reason", required=True)
    parser.add_argument("--notes")
    parser.add_argument("--negate", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not args.reason.strip() or not args.actor.strip():
        parser.error("--actor and --reason must not be blank")

    settings = LabelAccountSettings()
    if not settings.moderation_auth_token:
        print("MODERATION_AUTH_TOKEN is not set", file=sys.stderr)
        return 1

    did = args.did or await resolve_did(args.handle)
    if not did.startswith("did:"):
        parser.error(f"not a DID: {did}")

    action = "label_negated" if args.negate else "label_applied"
    verb = "negate" if args.negate else "apply"
    print(f"{verb} {args.val!r} on {did} (actor={args.actor}, reason={args.reason})")

    async with ModerationClient(
        base_url=settings.moderation_service_url,
        auth_token=settings.moderation_auth_token,
    ) as client:
        if not args.dry_run:
            emitted = await client.emit_label(did, args.val, neg=args.negate)
            await client.record_event(
                subject_uri=did,
                action=action,
                actor=args.actor,
                reason=args.reason,
                notes=args.notes,
            )
            print(f"emitted seq={emitted['seq']}")

        labels = await client.query_labels(did)
        print(json.dumps(labels, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
