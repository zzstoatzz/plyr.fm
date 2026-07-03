#!/usr/bin/env -S uv run --script --quiet
"""mint a plyr developer token from an atproto app-password — no browser.

The normal dev-token path requires a browser OAuth consent redirect. This mints
the same kind of `is_developer_token` session by logging in with
`com.atproto.server.createSession` (identifier + app-password) and wrapping the
bearer JWTs into a session the PDS write path recognizes. Gated by
`AUTH_ALLOW_APP_PASSWORD_DEV_TOKENS` — enable in dev/staging only, never prod.

## Usage

```bash
# bootstrap: use an ACCOUNT password to mint a scoped, revocable app-password
# (com.atproto.server.createAppPassword) and then a dev token from it. reads the
# account password from $MAIN_BSKY_PASSWORD. --verify proves the write path by
# uploading a throwaway blob through the backend (the path that was 500ing).
uv run scripts/mint_dev_token.py --handle zzstoatzz.io --bootstrap --verify

# direct: you already have an app-password
uv run scripts/mint_dev_token.py --handle h.example --app-password xxxx-xxxx-xxxx-xxxx

# mint and rotate a CI secret in one shot
uv run scripts/mint_dev_token.py --handle zzstoatzz.io --bootstrap --set-gh-secret PLYR_TEST_TOKEN_1
```

The PDS is auto-resolved from the handle; pass `--pds` to override.
"""

import argparse
import asyncio
import os
import subprocess
import sys

import httpx
from dotenv import load_dotenv

from backend._internal.auth.app_password import (
    AppPasswordAuthError,
    create_app_password_session,
    resolve_pds,
)

load_dotenv()


async def _bootstrap_app_password(
    handle: str, account_password: str, pds: str, name: str
) -> str:
    """use an account password to mint a scoped, revocable app-password.

    this is the "token that can mint tokens" step: a full-password session is
    only used to call createAppPassword, then discarded. the returned
    app-password is what the dev-token session is actually built from.
    """
    async with httpx.AsyncClient(timeout=30) as http:
        s = await http.post(
            f"{pds}/xrpc/com.atproto.server.createSession",
            json={"identifier": handle, "password": account_password},
        )
        if s.status_code != 200:
            raise SystemExit(
                f"createSession failed for {handle}: {s.status_code} {s.text}"
            )
        access = s.json()["accessJwt"]
        r = await http.post(
            f"{pds}/xrpc/com.atproto.server.createAppPassword",
            headers={"Authorization": f"Bearer {access}"},
            json={"name": name},
        )
        if r.status_code != 200:
            raise SystemExit(f"createAppPassword failed: {r.status_code} {r.text}")
    return r.json()["password"]


async def _verify(token: str) -> str:
    """prove the minted session drives a real PDS write (uploadBlob).

    this is the exact bearer path that replaces the expired-OAuth 500. the blob
    is unreferenced (no record points at it) so the PDS garbage-collects it.
    returns the stored blob CID.
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
    subprocess.run(["gh", "secret", "set", name], input=value.encode(), check=True)
    print(f"✓ set GitHub secret {name}", file=sys.stderr)


async def _run(args: argparse.Namespace) -> str:
    pds = args.pds or await resolve_pds(args.handle)
    print(f"  pds: {pds}", file=sys.stderr)

    if args.bootstrap:
        account_password = os.getenv(args.account_password_env)
        if not account_password:
            raise SystemExit(f"--bootstrap needs ${args.account_password_env} set")
        app_password = await _bootstrap_app_password(
            args.handle, account_password, pds, args.name
        )
        print("✓ minted scoped app-password via createAppPassword", file=sys.stderr)
    else:
        app_password = args.app_password
        if not app_password:
            raise SystemExit("need --app-password (or --bootstrap)")

    result = await create_app_password_session(
        identifier=args.handle,
        app_password=app_password,
        pds_url=pds,
        token_name=args.name,
    )
    print(
        f"✓ minted dev token for {result['handle']} ({result['did']})", file=sys.stderr
    )
    token = result["token"]

    if args.verify:
        cid = await _verify(token)
        print(f"✓ write path verified — uploaded blob {cid}", file=sys.stderr)

    return token


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--handle", default=os.getenv("ZAT_TEST_HANDLE"))
    parser.add_argument("--pds", help="override PDS (default: resolved from handle)")
    parser.add_argument(
        "--app-password",
        default=os.getenv("ZAT_TEST_PASSWORD"),
        help="an existing app-password (direct mode)",
    )
    parser.add_argument(
        "--bootstrap",
        action="store_true",
        help="mint a scoped app-password from an account password first",
    )
    parser.add_argument(
        "--account-password-env",
        default="MAIN_BSKY_PASSWORD",
        help="env var holding the account password for --bootstrap",
    )
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

    if not args.handle:
        parser.error("need --handle (or ZAT_TEST_HANDLE in .env)")

    try:
        token = asyncio.run(_run(args))
    except AppPasswordAuthError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 1

    if args.set_gh_secret:
        _set_gh_secret(args.set_gh_secret, token)

    # the token itself goes to stdout so it can be captured/piped
    print(token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
