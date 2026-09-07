"""Check or renew musician developer tokens through normal OAuth, then sync sops."""

import argparse
import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

ROOT = Path(__file__).parent
STORE = Path.home() / "tangled.org/zzstoatzz.io/secrets/prod.yaml"
API = "https://api.plyr.fm"


def checked(response: httpx.Response) -> httpx.Response:
    if response.status_code >= 400:
        raise RuntimeError(
            f"OAuth HTTP {response.status_code} on {response.request.url.path}"
        )
    return response


def expiration(client: httpx.Client, token: str) -> datetime | None:
    response = checked(
        client.get(
            API + "/auth/developer-tokens", headers={"Authorization": "Bearer " + token}
        )
    )
    matches = [
        value for value in response.json()["tokens"] if value["session_id"] == token[:8]
    ]
    if len(matches) != 1:
        raise ValueError("Could not uniquely identify the current developer token")
    value = matches[0]["expires_at"]
    return datetime.fromisoformat(value) if value else None


def authorize(client: httpx.Client, entry: dict, url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "pds.zat.dev":
        raise ValueError("Unexpected authorization host")
    request_uri = parse_qs(parsed.query)["request_uri"][0]
    response = checked(
        client.post(
            "https://pds.zat.dev/oauth/authorize",
            json={
                "request_uri": request_uri,
                "username": entry["handle"],
                "password": entry["password"],
            },
        )
    )
    callback = response.json()["redirect_uri"]
    parsed = urlparse(callback)
    if parsed.scheme != "https" or parsed.hostname != "api.plyr.fm":
        raise ValueError("Unexpected callback host")
    response = checked(client.get(callback))
    exchange = parse_qs(urlparse(response.headers["location"]).query)["exchange_token"][
        0
    ]
    return checked(
        client.post(API + "/auth/exchange", json={"exchange_token": exchange})
    ).json()["session_id"]


def renew(client: httpx.Client, entry: dict) -> str:
    response = checked(
        client.get(API + "/auth/start", params={"handle": entry["handle"]})
    )
    session = authorize(client, entry, response.headers["location"])
    response = checked(
        client.post(
            API + "/auth/developer-token/start",
            headers={"Authorization": "Bearer " + session},
            json={"name": "musician-studio", "expires_in_days": 30},
        )
    )
    token = authorize(client, entry, response.json()["auth_url"])
    artist = checked(
        client.get(API + "/artists/me", headers={"Authorization": "Bearer " + token})
    ).json()
    if artist["did"] != entry["did"]:
        raise ValueError("Renewed credential belongs to another artist")
    expiration(client, token)
    return token


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--renew-if-needed", action="store_true")
    args = parser.parse_args()
    raw = subprocess.run(
        ["sops", "-d", "--output-type", "json", str(STORE)],
        capture_output=True,
        check=True,
    )
    entries = json.loads(raw.stdout)["atproto"]["agent_musicians"]
    try:
        check_accounts(entries, args.renew_if_needed)
    finally:
        if args.renew_if_needed:
            subprocess.run(
                [sys.executable, str(ROOT / "provision_tokens.py")], check=True
            )


def check_accounts(entries: dict, renew_if_needed: bool) -> None:
    for name in ("moss", "kite", "reed"):
        entry = entries[name]
        with httpx.Client(timeout=60, follow_redirects=False) as client:
            try:
                expires = expiration(client, entry["plyr_token"])
            except RuntimeError:
                if not renew_if_needed:
                    raise
                expires = datetime.now(UTC)
            due = expires is not None and expires <= datetime.now(UTC) + timedelta(
                days=7
            )
            if due and renew_if_needed:
                token = renew(client, entry)
                subprocess.run(
                    [
                        "sops",
                        "set",
                        "--value-stdin",
                        str(STORE),
                        f'["atproto"]["agent_musicians"]["{name}"]["plyr_token"]',
                    ],
                    input=json.dumps(token).encode(),
                    capture_output=True,
                    check=True,
                )
                expires = expiration(client, token)
            print(
                json.dumps(
                    {
                        "musician": name,
                        "expires_at": expires.isoformat() if expires else None,
                        "renewal_due": due,
                        "renewed": due and renew_if_needed,
                    }
                )
            )


if __name__ == "__main__":
    main()
