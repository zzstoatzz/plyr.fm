"""Contract tests for the post-deploy canary traversal."""

import ipaddress
import json
import tomllib
from io import BytesIO
from pathlib import Path
from typing import ClassVar
from unittest.mock import patch

import canary_smoke

ROOT = Path(__file__).resolve().parents[1]


class _UrlResponse:
    status = 200
    headers: ClassVar[dict[str, str]] = {"x-request-id": "req-test"}

    def __enter__(self) -> "_UrlResponse":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self) -> bytes:
        return BytesIO(json.dumps({"status": "ok"}).encode()).read()


def _response(body: dict[str, object], status: int = 200) -> canary_smoke.Response:
    return canary_smoke.Response(
        status=status,
        headers={"x-request-id": "req-test"},
        body=body,
    )


PLAYLIST_SUMMARY = {
    "object": "playlist",
    "id": "pls_verified",
    "record": {
        "uri": "at://did:plc:owner/fm.plyr.list/playlist",
        "cid": "bafyplaylist",
    },
    "sources": {"record": "verified_repo", "membership": "verified_repo"},
}
PLAYLIST_DETAIL = {
    **PLAYLIST_SUMMARY,
    "members": [],
    "metrics": {"member_count": 0, "available_count": 0, "total_plays": 0},
}
ARTIST_METRICS = {
    "object": "artist_metrics",
    "artist_did": "did:plc:artist",
    "totals": {"plays": 7, "tracks": 1, "duration_seconds": 180},
    "top_track": {
        "id": "trk_verified",
        "record": {
            "uri": "at://did:plc:artist/fm.plyr.track/one",
            "cid": "bafyrecord",
        },
        "title": "Verified Song",
        "play_count": 7,
    },
    "sources": {
        "catalog": "verified_repo",
        "duration": "verified_repo",
        "plays": "application_metrics",
    },
    "projection": {"verification": "verified_repo"},
}


def test_request_identifies_the_smoke_client() -> None:
    with patch.object(
        canary_smoke.urllib.request, "urlopen", return_value=_UrlResponse()
    ) as urlopen:
        response = canary_smoke._request("https://api.next.plyr.fm", "/v1")

    assert response.status == 200
    request = urlopen.call_args.args[0]
    assert request.get_header("User-agent") == "plyr-zig-canary-smoke/1"


def test_canary_declares_public_auth_config_but_never_secret_values() -> None:
    config = tomllib.loads((ROOT / "fly.canary.toml").read_text())
    environment = config["env"]
    assert environment["ZIG_OAUTH_CLIENT_ID"] == (
        "https://api.next.plyr.fm/oauth-client-metadata.json"
    )
    assert environment["ZIG_OAUTH_REDIRECT_URI"] == (
        "https://api.next.plyr.fm/auth/callback"
    )
    assert environment["ZIG_OAUTH_FRONTEND_ORIGIN"] == "https://next.plyr.fm"
    assert environment["ZIG_OAUTH_SCOPE"] == "atproto transition:generic"
    assert environment["AUTH_START_CLIENT_LIMIT"] == "10"
    assert environment["AUTH_START_SUBJECT_LIMIT"] == "10"
    assert environment["AUTH_START_GLOBAL_LIMIT"] == "120"
    assert environment["AUTH_START_WINDOW_SECONDS"] == "60"
    trusted_proxies = {
        ipaddress.ip_network(value)
        for value in environment["AUTH_TRUSTED_PROXY_CIDRS"].split(",")
    }
    assert len(trusted_proxies) == 22
    assert ipaddress.ip_network("173.245.48.0/20") in trusted_proxies
    assert ipaddress.ip_network("2a06:98c0::/29") in trusted_proxies
    assert "ZIG_OAUTH_CLIENT_PRIVATE_KEY" not in environment
    assert "ZIG_AUTH_ENCRYPTION_KEY" not in environment

    workflow = (ROOT.parent / ".github/workflows/deploy-staging.yml").read_text()
    assert "preflight isolated canary credentials" in workflow
    assert "apply migrations to the isolated next branch" in workflow
    assert '"ZIG_AUTH_ENCRYPTION_KEY"' in workflow
    assert '"ZIG_OAUTH_CLIENT_PRIVATE_KEY"' in workflow


def test_auth_boundary_requires_confidential_metadata_and_cookie_security() -> None:
    responses = {
        ("/oauth-client-metadata.json", "GET"): _response(
            {
                "client_id": "https://api.next.plyr.fm/oauth-client-metadata.json",
                "redirect_uris": ["https://api.next.plyr.fm/auth/callback"],
                "token_endpoint_auth_method": "private_key_jwt",
                "dpop_bound_access_tokens": True,
                "jwks": {"keys": [{"kty": "EC", "crv": "P-256"}]},
            }
        ),
        ("/auth/pds-options", "GET"): _response({"enabled": False, "options": []}),
        ("/auth/me", "GET"): _response(
            {
                "error": {
                    "code": "authentication_required",
                    "message": "Authentication is required for this resource.",
                    "request_id": "req-test",
                }
            },
            status=401,
        ),
        ("/auth/start?handle=not-a-handle", "GET"): _response(
            {
                "error": {
                    "code": "invalid_request",
                    "message": "The request is invalid.",
                    "request_id": "req-test",
                }
            },
            status=400,
        ),
        (
            "/auth/callback?code=unused&state=QkJCQkJCQkJCQkJCQkJCQg&iss=https%3A%2F%2Fauth.example",
            "GET",
        ): canary_smoke.Response(
            status=303,
            headers={
                "x-request-id": "req-test",
                "location": "https://next.plyr.fm/?auth_error=expired",
                "set-cookie": (
                    "__Host-plyr_oauth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
                ),
            },
            body={},
        ),
        ("/auth/logout", "POST"): canary_smoke.Response(
            status=200,
            headers={
                "x-request-id": "req-test",
                "set-cookie": (
                    "__Host-plyr_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
                ),
                "cache-control": "no-store",
                "pragma": "no-cache",
            },
            body={"message": "logged out"},
        ),
    }

    def request(
        _: str,
        path: str,
        *,
        method: str = "GET",
        origin: str | None = None,
        follow_redirects: bool = True,
    ) -> canary_smoke.Response:
        if path == "/auth/logout" and method == "POST" and origin is None:
            return _response(
                {
                    "error": {
                        "code": "forbidden",
                        "message": "The request origin is not allowed.",
                        "request_id": "req-test",
                    }
                },
                status=403,
            )
        assert origin in (None, "https://next.plyr.fm")
        if path.startswith("/auth/callback"):
            assert follow_redirects is False
        return responses[(path, method)]

    with patch.object(canary_smoke, "_request", side_effect=request):
        canary_smoke._verify_auth_boundary("https://canary.example")


def test_real_product_reads_traverse_projected_track_and_artist() -> None:
    track = {
        "object": "track",
        "id": "trk_verified",
        "record": {
            "uri": "at://did:plc:artist/fm.plyr.track/one",
            "cid": "bafyrecord",
            "commit": "bafycommit",
        },
        "metadata": {"title": "Verified Song"},
        "artist": {"did": "did:plc:artist"},
        "metrics": {"play_count": 7},
        "sources": {"record": "verified_repo", "metrics": "application_metrics"},
        "projection": {"verification": "verified_repo"},
    }
    responses = {
        "/v1/tracks?limit=20": _response({"object": "list", "data": [track]}),
        "/v1/tracks/trk_verified": _response(track),
        "/v1/tracks/trk_verified/playback": _response(
            {
                "object": "playback",
                "track_id": "trk_verified",
                "record": track["record"],
                "authorization": {"audience": "anonymous", "status": "granted"},
                "availability": {
                    "status": "available",
                    "delivery": {
                        "url": "https://audio.example/one.mp3",
                        "source": "authored_record",
                        "integrity": "unverified",
                    },
                },
            }
        ),
        "/v1/artists/did:plc:artist": _response(
            {"object": "artist", "did": "did:plc:artist"}
        ),
        "/v1/artists/did%3Aplc%3Aartist/metrics": _response(ARTIST_METRICS),
        "/v1/search?q=Verified%20Song&types=track&limit=10": _response(
            {
                "object": "list",
                "query": "Verified Song",
                "data": [
                    {
                        "id": "trk_verified",
                        "record": {
                            "uri": track["record"]["uri"],
                            "cid": track["record"]["cid"],
                        },
                        "sources": {"record": "verified_repo"},
                        "projection": {"verification": "verified_repo"},
                    }
                ],
            }
        ),
        "/v1/albums?artist_did=did%3Aplc%3Aartist&limit=1": _response(
            {"object": "list", "data": []}
        ),
        "/v1/playlists?limit=1": _response(
            {"object": "list", "data": [PLAYLIST_SUMMARY]}
        ),
        "/v1/playlists/pls_verified": _response(PLAYLIST_DETAIL),
    }

    def request(_: str, path: str) -> canary_smoke.Response:
        return responses[path]

    with patch.object(canary_smoke, "_request", side_effect=request):
        canary_smoke._verify_real_product_reads("https://canary.example")


def test_real_product_reads_traverse_album_when_present() -> None:
    track = {
        "object": "track",
        "id": "trk_verified",
        "record": {
            "uri": "at://did:plc:artist/fm.plyr.track/one",
            "cid": "bafyrecord",
            "commit": "bafycommit",
        },
        "metadata": {"title": "Verified Song"},
        "artist": {"did": "did:plc:artist"},
        "metrics": {"play_count": 0},
        "sources": {"record": "verified_repo", "metrics": "derived"},
        "projection": {"verification": "verified_repo"},
    }
    album_summary = {
        "object": "album",
        "id": "alb_verified",
        "owner": {"did": "did:plc:artist"},
        "sources": {"record": "verified_repo"},
        "projection": {"verification": "verified_repo"},
    }
    responses = {
        "/v1/tracks?limit=20": _response({"object": "list", "data": [track]}),
        "/v1/tracks/trk_verified": _response(track),
        "/v1/tracks/trk_verified/playback": _response(
            {
                "object": "playback",
                "track_id": "trk_verified",
                "record": track["record"],
                "authorization": {"audience": "anonymous", "status": "granted"},
                "availability": {
                    "status": "available",
                    "delivery": {
                        "url": "https://audio.example/one.mp3",
                        "source": "authored_record",
                        "integrity": "unverified",
                    },
                },
            }
        ),
        "/v1/artists/did:plc:artist": _response(
            {"object": "artist", "did": "did:plc:artist"}
        ),
        "/v1/artists/did%3Aplc%3Aartist/metrics": _response(ARTIST_METRICS),
        "/v1/search?q=Verified%20Song&types=track&limit=10": _response(
            {
                "object": "list",
                "query": "Verified Song",
                "data": [
                    {
                        "id": "trk_verified",
                        "record": {
                            "uri": track["record"]["uri"],
                            "cid": track["record"]["cid"],
                        },
                        "sources": {"record": "verified_repo"},
                        "projection": {"verification": "verified_repo"},
                    }
                ],
            }
        ),
        "/v1/albums?artist_did=did%3Aplc%3Aartist&limit=1": _response(
            {"object": "list", "data": [album_summary]}
        ),
        "/v1/albums/alb_verified": _response(album_summary),
        "/v1/playlists?limit=1": _response(
            {"object": "list", "data": [PLAYLIST_SUMMARY]}
        ),
        "/v1/playlists/pls_verified": _response(PLAYLIST_DETAIL),
    }

    def request(_: str, path: str) -> canary_smoke.Response:
        return responses[path]

    with patch.object(canary_smoke, "_request", side_effect=request):
        canary_smoke._verify_real_product_reads("https://canary.example")


def test_real_product_reads_reject_empty_projection() -> None:
    with patch.object(
        canary_smoke,
        "_request",
        return_value=_response({"object": "list", "data": []}),
    ):
        try:
            canary_smoke._verify_real_product_reads("https://canary.example")
        except AssertionError as error:
            assert str(error) == "next projection has no public tracks"
        else:
            raise AssertionError("empty projection unexpectedly passed")


def test_sustained_play_requires_redis_claim_and_duplicate_receipt() -> None:
    track = {
        "id": "trk_verified",
        "record": {"uri": "at://did:plc:artist/fm.plyr.track/one"},
        "metrics": {"play_count": 7},
    }
    responses = iter(
        (
            canary_smoke.Response(
                status=200,
                headers={
                    "x-request-id": "req-first",
                    "set-cookie": "plyr_play_id=abcdefghijklmnopqrstuv; Secure",
                },
                body={
                    "object": "play_receipt",
                    "track_id": "trk_verified",
                    "record": track["record"],
                    "play_count": 8,
                    "counted": True,
                    "dedup": {"status": "claimed", "window_seconds": 180},
                },
            ),
            canary_smoke.Response(
                status=200,
                headers={"x-request-id": "req-duplicate"},
                body={
                    "object": "play_receipt",
                    "track_id": "trk_verified",
                    "record": track["record"],
                    "play_count": 8,
                    "counted": False,
                    "dedup": {"status": "duplicate", "window_seconds": 180},
                },
            ),
        )
    )

    with patch.object(canary_smoke, "_request", side_effect=responses) as request:
        canary_smoke._verify_sustained_play("https://canary.example", track)

    first_call, duplicate_call = request.call_args_list
    assert first_call.kwargs == {"method": "POST"}
    assert duplicate_call.kwargs == {
        "method": "POST",
        "cookie": "plyr_play_id=abcdefghijklmnopqrstuv",
    }


def test_product_only_transport_does_not_probe_infrastructure_routes() -> None:
    api = _response({"object": "api", "version": "v1"})

    with (
        patch.object(canary_smoke, "_request", return_value=api) as request,
        patch.object(
            canary_smoke,
            "_verify_real_product_reads",
            side_effect=RuntimeError("stop after transport assertion"),
        ) as reads,
        patch.object(canary_smoke, "_verify_auth_boundary") as auth,
    ):
        try:
            canary_smoke.verify_product("https://api.next.plyr.fm/")
        except RuntimeError as error:
            assert str(error) == "stop after transport assertion"
        else:
            raise AssertionError("product verification unexpectedly continued")

    request.assert_called_once_with("https://api.next.plyr.fm", "/v1")
    auth.assert_called_once_with("https://api.next.plyr.fm")
    reads.assert_called_once_with("https://api.next.plyr.fm")
