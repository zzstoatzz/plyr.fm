#!/usr/bin/env -S uv run --script --quiet
"""mint a plyr developer token from an atproto app-password — no browser.

The normal dev-token path requires a browser OAuth consent redirect. This mints
the same kind of `is_developer_token` session by logging in with
`com.atproto.server.createSession` (identifier + app-password) and wrapping the
bearer JWTs into a session the PDS write path recognizes. Gated by
`AUTH_ALLOW_APP_PASSWORD_DEV_TOKENS` — enable in dev/staging only, never prod.

## Usage

```bash
# mint against the ZAT_TEST_* account in the root .env, print the token
uv run scripts/mint_dev_token.py

# also prove the backend write path works (uploads a throwaway blob to the PDS —
# the exact path that was 500ing with SessionExpiredError)
uv run scripts/mint_dev_token.py --verify

# mint and rotate a CI secret in one shot
uv run scripts/mint_dev_token.py --set-gh-secret PLYR_TEST_TOKEN_1
```

Needs `ZAT_TEST_HANDLE` / `ZAT_TEST_PASSWORD` / `ZAT_TEST_PDS` in the root `.env`
(or pass `--handle` / `--password` / `--pds`), and the backend's `.env` for the
DB + encryption key the session is written with.
"""

import argparse
import asyncio
import os
import subprocess
import sys

from dotenv import load_dotenv

from backend._internal.auth.app_password import (
    AppPasswordAuthError,
    create_app_password_session,
)

load_dotenv()


async def _mint(
    handle: str, password: str, pds: str, name: str | None
) -> dict[str, str]:
    return await create_app_password_session(
        identifier=handle, app_password=password, pds_url=pds, token_name=name
    )


async def _verify(token: str) -> str:
    """prove the minted session drives a real PDS write (uploadBlob).

    this is the exact bearer path that replaces the expired-OAuth 500. returns
    the stored blob CID.
    """
    from backend._internal import get_session
    from backend._internal.atproto.client import upload_blob

    session = await get_session(token)
    if session is None:
        raise SystemExit("verify failed: minted session not found in DB")
    blob = await upload_blob(
        session,
        data=b"RIFF\x24\x00\x00\x00WAVEfmt mint-dev-token verify",
        content_type="audio/wav",
    )
    return blob["ref"]["$link"]


def _set_gh_secret(name: str, value: str) -> None:
    subprocess.run(
        ["gh", "secret", "set", name],
        input=value.encode(),
        check=True,
    )
    print(f"✓ set GitHub secret {name}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--handle", default=os.getenv("ZAT_TEST_HANDLE"))
    parser.add_argument("--password", default=os.getenv("ZAT_TEST_PASSWORD"))
    parser.add_argument("--pds", default=os.getenv("ZAT_TEST_PDS"))
    parser.add_argument("--name", default="mint_dev_token.py", help="token label")
    parser.add_argument(
        "--verify",
        action="store_true",
        help="upload a throwaway blob through the backend to prove the write path",
    )
    parser.add_argument(
        "--set-gh-secret",
        metavar="NAME",
        help="rotate this GitHub Actions secret to the minted token",
    )
    args = parser.parse_args()

    if not (args.handle and args.password and args.pds):
        parser.error(
            "need --handle/--password/--pds or ZAT_TEST_HANDLE/PASSWORD/PDS in .env"
        )

    try:
        result = asyncio.run(_mint(args.handle, args.password, args.pds, args.name))
    except AppPasswordAuthError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 1

    token = result["token"]
    print(
        f"✓ minted dev token for {result['handle']} ({result['did']})", file=sys.stderr
    )

    if args.verify:
        cid = asyncio.run(_verify(token))
        print(f"✓ write path verified — uploaded blob {cid}", file=sys.stderr)

    if args.set_gh_secret:
        _set_gh_secret(args.set_gh_secret, token)

    # the token itself goes to stdout so it can be captured/piped
    print(token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
