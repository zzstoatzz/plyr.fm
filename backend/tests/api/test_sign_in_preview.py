"""GET /auth/sign-in-preview — who a sign-in is for and where it redirects."""

from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
from atproto import DidDocument
from httpx import ASGITransport, AsyncClient

from backend._internal.auth import sign_in_preview
from backend._internal.auth.sign_in_preview import (
    SignInPreview,
    resolve_sign_in_preview,
)
from backend.main import app

DID = "did:plc:moth"
PDS = "https://amanita.us-east.host.bsky.network"
DOC = DidDocument.from_dict(
    {
        "id": DID,
        "alsoKnownAs": ["at://moth.bsky.social"],
        "service": [
            {
                "id": "#atproto_pds",
                "type": "AtprotoPersonalDataServer",
                "serviceEndpoint": PDS,
            }
        ],
    }
)


def _patch_resolver(
    did: str | None = DID, doc: DidDocument | None = DOC
) -> tuple[Any, Any]:
    return (
        patch.object(
            sign_in_preview._resolver.handle, "resolve", AsyncMock(return_value=did)
        ),
        patch.object(
            sign_in_preview._resolver.did, "resolve", AsyncMock(return_value=doc)
        ),
    )


async def test_preview_uses_authserver_host_not_pds() -> None:
    handle_patch, did_patch = _patch_resolver()
    discover = AsyncMock(return_value="https://bsky.social")
    profile = AsyncMock(return_value={"display_name": "moth", "avatar": "https://a/1"})
    with (
        handle_patch,
        did_patch,
        patch.object(sign_in_preview, "discover_authserver_from_pds_async", discover),
        patch.object(sign_in_preview, "_fetch_profile", profile),
    ):
        preview = await resolve_sign_in_preview("@moth.bsky.social")

    assert preview == SignInPreview(
        did=DID,
        handle="moth.bsky.social",
        display_name="moth",
        avatar_url="https://a/1",
        sign_in_host="bsky.social",
    )
    discover.assert_awaited_once_with(PDS)


async def test_preview_accepts_did_and_reads_handle_from_doc() -> None:
    handle_patch, did_patch = _patch_resolver()
    with (
        handle_patch as handle_resolve,
        did_patch,
        patch.object(
            sign_in_preview,
            "discover_authserver_from_pds_async",
            AsyncMock(return_value="https://bsky.social"),
        ),
        patch.object(
            sign_in_preview,
            "_fetch_profile",
            AsyncMock(return_value={"display_name": None, "avatar": None}),
        ),
    ):
        preview = await resolve_sign_in_preview(f"at://{DID}")

    assert preview is not None
    assert preview.handle == "moth.bsky.social"
    assert preview.display_name == "moth.bsky.social"
    handle_resolve.assert_not_awaited()


async def test_preview_degrades_when_authserver_discovery_fails() -> None:
    handle_patch, did_patch = _patch_resolver()
    with (
        handle_patch,
        did_patch,
        patch.object(
            sign_in_preview,
            "discover_authserver_from_pds_async",
            AsyncMock(side_effect=httpx.ConnectError("down")),
        ),
        patch.object(
            sign_in_preview,
            "_fetch_profile",
            AsyncMock(return_value={"display_name": "moth", "avatar": None}),
        ),
    ):
        preview = await resolve_sign_in_preview("moth.bsky.social")

    assert preview is not None
    assert preview.sign_in_host is None


async def test_preview_returns_none_for_unresolvable_handle() -> None:
    handle_patch, did_patch = _patch_resolver(did=None)
    with handle_patch, did_patch:
        assert await resolve_sign_in_preview("moth.bsky.socal") is None


async def test_endpoint_404s_when_account_not_found() -> None:
    with patch(
        "backend.api.auth.resolve_sign_in_preview", AsyncMock(return_value=None)
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get("/auth/sign-in-preview", params={"handle": "nope.x"})
    assert r.status_code == 404


async def test_endpoint_returns_preview() -> None:
    preview = SignInPreview(
        did=DID,
        handle="moth.bsky.social",
        display_name="moth",
        avatar_url=None,
        sign_in_host="bsky.social",
    )
    with patch(
        "backend.api.auth.resolve_sign_in_preview", AsyncMock(return_value=preview)
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            r = await client.get(
                "/auth/sign-in-preview", params={"handle": "moth.bsky.social"}
            )
    assert r.status_code == 200
    assert r.json()["sign_in_host"] == "bsky.social"
