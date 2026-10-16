"""Bounded metadata census; reports candidates and never ingests them."""

import argparse
import asyncio
import ipaddress
import json
import re
import socket
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import anyio
import httpx
from pydantic import BaseModel, ConfigDict, field_validator

DISCOVERY = ("https://lightrail.microcosm.blue", "https://bsky.network")
IDENTITY = "https://slingshot.microcosm.blue"


def record_owner(uri: str, collection: str) -> str:
    parts = uri.split("/")
    if (
        len(parts) != 5
        or parts[0:2] != ["at:", ""]
        or not re.fullmatch(r"did:[a-z]+:[A-Za-z0-9._:%-]+", parts[2])
        or parts[3] != collection
        or parts[4] in {".", ".."}
        or not re.fullmatch(r"[A-Za-z0-9._~:-]{1,512}", parts[4])
    ):
        raise ValueError(
            "expected an exact DID-based record URI in the audited collection"
        )
    return parts[2]


class IndexSnapshot(BaseModel):
    model_config = ConfigDict(strict=True)

    observed_at: datetime
    uris: list[str]
    artists: list[list[str | None]]

    @field_validator("artists")
    @classmethod
    def valid_artists(cls, rows: list[list[str | None]]) -> list[list[str | None]]:
        if any(
            len(row) != 2
            or not isinstance(row[0], str)
            or not row[0].startswith("did:")
            for row in rows
        ):
            raise ValueError("expected DID/handle pairs")
        return rows

    @field_validator("observed_at")
    @classmethod
    def aware_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("snapshot observation needs a timezone")
        return value


@dataclass(frozen=True)
class Limits:
    repositories: int = 1000
    pages_per_source: int = 10
    pages_per_repo: int = 20
    requests: int = 1500
    response_bytes: int = 4 * 1024 * 1024
    total_bytes: int = 128 * 1024 * 1024
    concurrency: int = 4
    seconds: int = 600


@dataclass
class RepoObservation:
    did: str
    uris: list[str] = field(default_factory=list)
    complete: bool = False
    error: str | None = None


class BudgetExceeded(ValueError):
    pass


class PublicMetadataClient:
    def __init__(self, client: httpx.AsyncClient, limits: Limits) -> None:
        self.client = client
        self.limits = limits
        self.requests = 0
        self.bytes = 0
        self.semaphore = asyncio.Semaphore(limits.concurrency)

    async def get(
        self, base: str, method: str, params: dict[str, Any]
    ) -> dict[str, Any]:
        async with self.semaphore:
            if self.requests >= self.limits.requests:
                raise BudgetExceeded("request budget exhausted")
            if self.bytes >= self.limits.total_bytes:
                raise BudgetExceeded("response byte budget exhausted")
            self.requests += 1
            url = httpx.URL(base)
            if (
                url.scheme != "https"
                or not url.host
                or url.userinfo
                or url.query
                or url.fragment
                or url.path not in {"", "/"}
            ):
                raise ValueError("invalid service origin")
            addresses = await anyio.getaddrinfo(
                url.host, url.port or 443, type=socket.SOCK_STREAM
            )
            ips = [ipaddress.ip_address(item[4][0]) for item in addresses]
            ips = [
                ip.ipv4_mapped or ip if isinstance(ip, ipaddress.IPv6Address) else ip
                for ip in ips
            ]
            if not ips or any(not ip.is_global or ip.is_multicast for ip in ips):
                raise ValueError(
                    "service did not resolve exclusively to public addresses"
                )
            target = url.copy_with(
                host=str(sorted(ips, key=lambda ip: ip.version)[0]),
                path=f"/xrpc/{method}",
            )
            async with self.client.stream(
                "GET",
                target,
                params=params,
                headers={
                    "Host": url.netloc.decode(),
                    "User-Agent": "plyr.fm-metadata-audit",
                    "Accept-Encoding": "identity",
                },
                extensions={"sni_hostname": url.host},
                follow_redirects=False,
            ) as response:
                response.raise_for_status()
                if response.headers.get("content-encoding", "identity") != "identity":
                    raise ValueError("compressed metadata response refused")
                body = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    self.bytes += len(chunk)
                    body.extend(chunk)
                    if (
                        len(body) > self.limits.response_bytes
                        or self.bytes > self.limits.total_bytes
                    ):
                        raise BudgetExceeded("response byte budget exhausted")
                result = json.loads(body)
                if not isinstance(result, dict):
                    raise ValueError("expected an object response")
                return result


def error_kind(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"http_{exc.response.status_code}"
    if isinstance(exc, BudgetExceeded):
        return str(exc)
    return type(exc).__name__


async def discover(
    client: PublicMetadataClient, source: str, collection: str
) -> tuple[set[str], bool, str | None]:
    dids: set[str] = set()
    cursor: str | None = None
    seen: set[str] = set()
    try:
        for _ in range(client.limits.pages_per_source):
            params: dict[str, Any] = {"collection": collection, "limit": 2000}
            if cursor:
                params["cursor"] = cursor
            page = await client.get(
                source, "com.atproto.sync.listReposByCollection", params
            )
            repos = page["repos"]
            if not isinstance(repos, list):
                raise ValueError("invalid repository list")
            for repo in repos:
                did = repo["did"]
                if not isinstance(did, str) or not did.startswith("did:"):
                    raise ValueError("invalid DID")
                dids.add(did)
                if len(dids) > client.limits.repositories:
                    return (
                        set(sorted(dids)[: client.limits.repositories]),
                        False,
                        "repository budget exhausted",
                    )
            cursor = page.get("cursor")
            if cursor is None:
                return dids, True, None
            if not isinstance(cursor, str) or not cursor or cursor in seen:
                raise ValueError("invalid or repeated discovery cursor")
            seen.add(cursor)
        return dids, False, "discovery page budget exhausted"
    except (
        httpx.HTTPError,
        httpx.InvalidURL,
        ValueError,
        KeyError,
        TypeError,
        OSError,
    ) as exc:
        return dids, False, error_kind(exc)


async def inspect_repo(
    client: PublicMetadataClient, did: str, collection: str
) -> RepoObservation:
    result = RepoObservation(did)
    cursor: str | None = None
    seen: set[str] = set()
    uris: set[str] = set()
    try:
        identity = await client.get(
            IDENTITY, "blue.microcosm.identity.resolveMiniDoc", {"identifier": did}
        )
        pds = identity["pds"]
        if not isinstance(pds, str):
            raise ValueError("invalid PDS")
        for _ in range(client.limits.pages_per_repo):
            params: dict[str, Any] = {
                "repo": did,
                "collection": collection,
                "limit": 100,
            }
            if cursor:
                params["cursor"] = cursor
            page = await client.get(pds, "com.atproto.repo.listRecords", params)
            records = page["records"]
            if not isinstance(records, list):
                raise ValueError("invalid record list")
            for record in records:
                uri = record["uri"]
                if not isinstance(uri, str) or record_owner(uri, collection) != did:
                    raise ValueError("record URI does not match the queried collection")
                uris.add(uri)
            result.uris = sorted(uris)
            cursor = page.get("cursor")
            if cursor is None:
                result.complete = True
                return result
            if not isinstance(cursor, str) or not cursor or cursor in seen:
                raise ValueError("invalid or repeated record cursor")
            seen.add(cursor)
        result.error = "record page budget exhausted"
    except (
        httpx.HTTPError,
        httpx.InvalidURL,
        ValueError,
        KeyError,
        TypeError,
        OSError,
    ) as exc:
        result.error = error_kind(exc)
    return result


def compare(
    observations: list[RepoObservation], indexed: set[str], excluded: set[str]
) -> dict[str, list[str]]:
    observed = {uri for repo in observations for uri in repo.uris}
    complete = {repo.did for repo in observations if repo.complete}
    absent = excluded - observed
    return {
        "intentional_exclusions": sorted((observed - indexed) & excluded),
        "unexplained_unindexed": sorted(observed - indexed - excluded),
        "indexed_policy_conflicts": sorted(indexed & excluded),
        "excluded_now_absent": sorted(
            uri for uri in absent if uri.split("/")[2] in complete
        ),
        "excluded_presence_unknown": sorted(
            uri for uri in absent if uri.split("/")[2] not in complete
        ),
        "indexed_not_observed": sorted(
            uri for uri in indexed - observed if uri.split("/")[2] in complete
        ),
    }


async def audit(
    client: PublicMetadataClient,
    snapshot: IndexSnapshot,
    excluded: set[str],
    collection: str,
) -> dict[str, Any]:
    started = datetime.now(UTC).isoformat()
    sources: dict[str, dict[str, Any]] = {}
    indexed = {
        uri
        for uri in snapshot.uris
        if len(uri.split("/")) == 5 and uri.split("/")[3] == collection
    }
    dids = {record_owner(uri, collection) for uri in indexed}
    dids.update(record_owner(uri, collection) for uri in excluded)
    observations: list[RepoObservation] = []
    deadline_exceeded = False
    try:
        async with asyncio.timeout(client.limits.seconds):
            for source in DISCOVERY:
                found, complete, error = await discover(client, source, collection)
                dids.update(found)
                sources[source] = {
                    "repositories": len(found),
                    "complete": complete,
                    "error": error,
                }
            selected = sorted(dids)[: client.limits.repositories]
            queue: asyncio.Queue[str] = asyncio.Queue()
            for did in selected:
                queue.put_nowait(did)

            async def worker() -> None:
                while not queue.empty():
                    did = queue.get_nowait()
                    observations.append(await inspect_repo(client, did, collection))

            async with asyncio.TaskGroup() as group:
                for _ in range(client.limits.concurrency):
                    group.create_task(worker())
    except TimeoutError:
        deadline_exceeded = True
    observed_dids = {repo.did for repo in observations}
    snapshot_age = (datetime.now(UTC) - snapshot.observed_at).total_seconds()
    stale_snapshot = not -300 <= snapshot_age <= 3600
    incomplete = (
        stale_snapshot
        or deadline_exceeded
        or len(dids) > client.limits.repositories
        or any(not source["complete"] for source in sources.values())
        or any(not repo.complete for repo in observations)
    )
    return {
        "started_at": started,
        "finished_at": datetime.now(UTC).isoformat(),
        "index_observed_at": snapshot.observed_at.isoformat(),
        "indexed_records_in_scope": len(indexed),
        "out_of_scope_indexed_count": len(set(snapshot.uris) - indexed),
        "stale_index_snapshot": stale_snapshot,
        "collection": collection,
        "complete": not incomplete,
        "deadline_exceeded": deadline_exceeded,
        "sources": sources,
        "limits": asdict(client.limits),
        "usage": {"requests": client.requests, "bytes": client.bytes},
        "uninspected_dids": sorted(dids - observed_dids),
        "unknown_artist_dids": sorted(dids - {row[0] for row in snapshot.artists}),
        "repositories": [
            asdict(repo) for repo in sorted(observations, key=lambda repo: repo.did)
        ],
        **compare(observations, indexed, excluded),
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index-snapshot", type=Path, required=True)
    parser.add_argument("--exclusions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--collection", required=True)
    args = parser.parse_args()
    snapshot = IndexSnapshot.model_validate_json(
        await anyio.Path(args.index_snapshot).read_text()
    )
    exclusions = json.loads(await anyio.Path(args.exclusions).read_text())
    subjects = exclusions["subjects"]
    if not isinstance(subjects, list) or any(
        not isinstance(uri, str) for uri in subjects
    ):
        raise ValueError("exclusions must contain record URI strings")
    async with httpx.AsyncClient(timeout=15, trust_env=False) as http:
        report = await audit(
            PublicMetadataClient(http, Limits()),
            snapshot,
            set(subjects),
            args.collection,
        )
    report["policy_source"] = str(args.exclusions)
    report["policy_enforcement_status"] = exclusions.get(
        "enforcement_status", "unknown"
    )
    await anyio.Path(args.output).write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                key: len(report[key])
                for key in (
                    "intentional_exclusions",
                    "unexplained_unindexed",
                    "indexed_policy_conflicts",
                    "excluded_now_absent",
                    "excluded_presence_unknown",
                    "uninspected_dids",
                )
            }
            | {"complete": report["complete"], "output": str(args.output)}
        )
    )
    return (
        0
        if report["complete"]
        and not report["unexplained_unindexed"]
        and not report["indexed_policy_conflicts"]
        and not report["indexed_not_observed"]
        else 1
    )


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
