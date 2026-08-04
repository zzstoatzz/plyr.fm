#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx", "plotext"]
# ///
"""chart cumulative plyr.fm users from the network itself — no database.

every signed-in user gets an `fm.plyr.actor.profile` record (rkey `self`)
upserted into their own PDS, so the network is the source of truth:

  1. lightrail `com.atproto.sync.listReposByCollection` enumerates every
     DID holding the collection
  2. slingshot `blue.microcosm.identity.resolveMiniDoc` resolves each
     DID to its PDS
  3. each PDS's `com.atproto.repo.getRecord` yields the record's `createdAt`
  4. plotext draws the cumulative curve

caveat: the record's `createdAt` is when the *record* was written, not when
the user first signed in — users predating the profile-record upsert (or who
never logged back in) are time-shifted or absent, so this slightly
undercounts relative to the `artists` table. it is the atproto-native number.

usage:
    uv run scripts/users_over_time.py
"""

import asyncio
from collections import Counter
from datetime import date, timedelta

import httpx
import plotext as plt

COLLECTION = "fm.plyr.actor.profile"
LIGHTRAIL = "https://lightrail.microcosm.blue"
SLINGSHOT = "https://slingshot.microcosm.blue"


async def list_dids(client: httpx.AsyncClient) -> list[str]:
    """enumerate every DID holding the profile collection via lightrail."""
    dids: list[str] = []
    cursor: str | None = None
    while True:
        params: dict[str, str | int] = {"collection": COLLECTION, "limit": 500}
        if cursor:
            params["cursor"] = cursor
        response = await client.get(
            f"{LIGHTRAIL}/xrpc/com.atproto.sync.listReposByCollection", params=params
        )
        response.raise_for_status()
        data = response.json()
        dids.extend(repo["did"] for repo in data.get("repos", []))
        if not (cursor := data.get("cursor")):
            return dids


async def resolve_pds(client: httpx.AsyncClient, did: str) -> str | None:
    """resolve a DID to its PDS endpoint via slingshot."""
    response = await client.get(
        f"{SLINGSHOT}/xrpc/blue.microcosm.identity.resolveMiniDoc",
        params={"identifier": did},
    )
    if response.status_code != 200:
        return None
    return response.json().get("pds")


async def fetch_created_at(
    client: httpx.AsyncClient, sem: asyncio.Semaphore, did: str
) -> str | None:
    """fetch the profile record's createdAt from the DID's own PDS."""
    async with sem:
        pds = await resolve_pds(client, did)
        if not pds:
            return None
        response = await client.get(
            f"{pds}/xrpc/com.atproto.repo.getRecord",
            params={"repo": did, "collection": COLLECTION, "rkey": "self"},
        )
        if response.status_code != 200:
            return None
        return response.json().get("value", {}).get("createdAt")


async def main() -> None:
    async with httpx.AsyncClient(timeout=15) as client:
        dids = await list_dids(client)
        print(f"{len(dids)} repos hold {COLLECTION}")
        sem = asyncio.Semaphore(20)
        results = await asyncio.gather(
            *(fetch_created_at(client, sem, did) for did in dids)
        )

    stamps = [r for r in results if r]
    if missing := len(results) - len(stamps):
        print(f"({missing} unresolvable/unfetchable, excluded)")

    by_day = Counter(date.fromisoformat(s[:10]) for s in stamps)
    start, end = min(by_day), max(by_day)
    days: list[date] = []
    cumulative: list[int] = []
    total = 0
    day = start
    while day <= end:
        total += by_day.get(day, 0)
        days.append(day)
        cumulative.append(total)
        day += timedelta(days=1)

    plt.date_form("Y-m-d")
    plt.plot([d.isoformat() for d in days], cumulative)
    plt.title(f"plyr.fm users over time ({total} profiles on the network)")
    plt.xlabel("date")
    plt.ylabel("cumulative profiles")
    plt.theme("clear")
    plt.plot_size(100, 25)
    plt.show()


if __name__ == "__main__":
    asyncio.run(main())
