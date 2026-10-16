import socket
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from backend.utilities import indexing_audit as audit

COLLECTION = "fm.plyr.track"


def uri(did: str, key: str) -> str:
    return f"at://did:plc:{did}/{COLLECTION}/{key}"


def snapshot(*uris: str) -> audit.IndexSnapshot:
    return audit.IndexSnapshot(
        observed_at=datetime.now(UTC),
        uris=list(uris),
        artists=[["did:plc:a", "a.test"]],
    )


@pytest.fixture(autouse=True)
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    async def resolve(*args: Any, **kwargs: Any) -> list[Any]:
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", 443))]

    monkeypatch.setattr(audit.anyio, "getaddrinfo", resolve)


async def test_census_pages_and_classifies_without_ingesting() -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.method == "GET"
        assert request.url.host == "1.1.1.1"
        assert request.extensions["sni_hostname"] == request.headers["host"]
        method = request.url.path.rsplit("/", 1)[1]
        cursor = request.url.params.get("cursor")
        if method == "com.atproto.sync.listReposByCollection":
            if request.headers["host"] == "bsky.network":
                return httpx.Response(200, json={"repos": [{"did": "did:plc:a"}]})
            if not cursor:
                return httpx.Response(
                    200, json={"repos": [{"did": "did:plc:a"}], "cursor": "next"}
                )
            return httpx.Response(200, json={"repos": [{"did": "did:plc:b"}]})
        if method == "blue.microcosm.identity.resolveMiniDoc":
            did = request.url.params["identifier"]
            return httpx.Response(
                200, json={"pds": "https://" + did.rsplit(":", 1)[1] + ".example.com"}
            )
        assert method == "com.atproto.repo.listRecords"
        did = request.url.params["repo"]
        if did == "did:plc:a":
            if cursor:
                return httpx.Response(200, json={"records": [{"uri": uri("a", "new")}]})
            return httpx.Response(
                200,
                json={
                    "records": [
                        {"uri": uri("a", "indexed")},
                        {"uri": uri("a", "excluded")},
                    ],
                    "cursor": "next",
                },
            )
        if did == "did:plc:b":
            return httpx.Response(200, json={"records": []})
        return httpx.Response(503)

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        report = await audit.audit(
            audit.PublicMetadataClient(http, audit.Limits()),
            snapshot(uri("a", "indexed"), uri("a", "conflict"), uri("d", "known")),
            {
                uri("a", "excluded"),
                uri("a", "conflict"),
                uri("b", "gone"),
                uri("e", "unknown"),
            },
            COLLECTION,
        )
    assert report["intentional_exclusions"] == [uri("a", "excluded")]
    assert report["unexplained_unindexed"] == [uri("a", "new")]
    assert report["indexed_policy_conflicts"] == [uri("a", "conflict")]
    assert report["excluded_now_absent"] == [uri("a", "conflict"), uri("b", "gone")]
    assert report["excluded_presence_unknown"] == [uri("e", "unknown")]
    assert report["indexed_not_observed"] == [uri("a", "conflict")]
    assert report["complete"] is False
    assert report["uninspected_dids"] == []
    assert report["usage"]["requests"] == len(requests)
    assert report["unknown_artist_dids"] == ["did:plc:b", "did:plc:d", "did:plc:e"]


@pytest.mark.parametrize(
    "failure", ["error", "repeated_cursor", "malformed", "page_limit"]
)
async def test_partial_repository_never_implies_absence(failure: str) -> None:
    pages = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal pages
        if "resolveMiniDoc" in request.url.path:
            return httpx.Response(200, json={"pds": "https://pds.example.com"})
        pages += 1
        if pages == 1 or failure == "repeated_cursor":
            return httpx.Response(
                200, json={"records": [{"uri": uri("a", "seen")}], "cursor": "next"}
            )
        if failure == "malformed":
            return httpx.Response(
                200, json={"records": [{"uri": uri("other", "wrong")}]}
            )
        return httpx.Response(503)

    limits = audit.Limits(pages_per_repo=1 if failure == "page_limit" else 20)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        repo = await audit.inspect_repo(
            audit.PublicMetadataClient(http, limits), "did:plc:a", COLLECTION
        )
    assert repo.complete is False
    assert repo.uris == [uri("a", "seen")]
    result = audit.compare([repo], {uri("a", "old")}, {uri("a", "absent")})
    assert result["excluded_now_absent"] == []
    assert result["excluded_presence_unknown"] == [uri("a", "absent")]
    assert result["indexed_not_observed"] == []


@pytest.mark.parametrize(
    "limits",
    [
        audit.Limits(requests=0),
        audit.Limits(response_bytes=5),
        audit.Limits(total_bytes=5),
    ],
)
async def test_network_budgets_are_reported_as_incomplete(limits: audit.Limits) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"repos": [{"did": "did:plc:a"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        client = audit.PublicMetadataClient(http, limits)
        report = await audit.audit(client, snapshot(), set(), COLLECTION)
    assert report["complete"] is False
    assert client.requests <= limits.requests
    assert any(source["error"] for source in report["sources"].values())


async def test_repository_budget_and_stale_snapshot_are_visible() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        if "listReposByCollection" in request.url.path:
            return httpx.Response(
                200, json={"repos": [{"did": "did:plc:a"}, {"did": "did:plc:b"}]}
            )
        if "resolveMiniDoc" in request.url.path:
            return httpx.Response(200, json={"pds": "https://pds.example.com"})
        return httpx.Response(200, json={"records": []})

    index = snapshot(uri("c", "known"))
    index.observed_at -= timedelta(hours=2)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        report = await audit.audit(
            audit.PublicMetadataClient(http, audit.Limits(repositories=1)),
            index,
            set(),
            COLLECTION,
        )
    assert report["complete"] is False
    assert report["stale_index_snapshot"] is True
    assert report["uninspected_dids"] == ["did:plc:c"]
    assert report["sources"][audit.DISCOVERY[0]]["complete"] is False


@pytest.mark.parametrize(
    "address", ["127.0.0.1", "169.254.169.254", "::ffff:127.0.0.1"]
)
async def test_private_dns_is_rejected_before_connection(
    monkeypatch: pytest.MonkeyPatch, address: str
) -> None:
    async def resolve(*args: Any, **kwargs: Any) -> list[Any]:
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]

    monkeypatch.setattr(audit.anyio, "getaddrinfo", resolve)

    def respond(request: httpx.Request) -> httpx.Response:
        pytest.fail("must not connect to a private address")

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        with pytest.raises(ValueError, match="public addresses"):
            await audit.PublicMetadataClient(http, audit.Limits()).get(
                "https://pds.example.com", "com.atproto.repo.listRecords", {}
            )


@pytest.mark.parametrize("mode", ["redirect", "compressed"])
async def test_no_redirects_or_compressed_responses(mode: str) -> None:
    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if mode == "redirect":
            return httpx.Response(302, headers={"location": "http://127.0.0.1/private"})
        return httpx.Response(200, headers={"content-encoding": "gzip"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        with pytest.raises((ValueError, httpx.HTTPStatusError)):
            await audit.PublicMetadataClient(http, audit.Limits()).get(
                "https://pds.example.com", "com.atproto.repo.listRecords", {}
            )
    assert calls == 1


async def test_deadline_never_reports_clean() -> None:
    async def respond(request: httpx.Request) -> httpx.Response:
        await audit.asyncio.sleep(1)
        return httpx.Response(200, json={"repos": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        report = await audit.audit(
            audit.PublicMetadataClient(http, audit.Limits(seconds=0)),
            snapshot(),
            {uri("a", "unknown")},
            COLLECTION,
        )
    assert report["complete"] is False
    assert report["deadline_exceeded"] is True
    assert report["excluded_presence_unknown"] == [uri("a", "unknown")]


async def test_clean_census_ignores_permissioned_space_records() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        if "listReposByCollection" in request.url.path:
            return httpx.Response(200, json={"repos": [{"did": "did:plc:a"}]})
        if "resolveMiniDoc" in request.url.path:
            return httpx.Response(200, json={"pds": "https://pds.example.com"})
        return httpx.Response(200, json={"records": [{"uri": uri("a", "one")}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        report = await audit.audit(
            audit.PublicMetadataClient(http, audit.Limits()),
            snapshot(
                uri("a", "one"),
                "at://did:plc:a/space/fm.plyr.privateMedia/self/did:plc:a/fm.plyr.track/private",
            ),
            set(),
            COLLECTION,
        )
    assert report["complete"] is True
    assert report["out_of_scope_indexed_count"] == 1
    assert report["indexed_records_in_scope"] == 1
    assert report["unexplained_unindexed"] == []
    assert report["indexed_not_observed"] == []
