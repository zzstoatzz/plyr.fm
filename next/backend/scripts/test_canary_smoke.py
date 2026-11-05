"""Contract tests for the post-deploy canary traversal."""

import json
import tomllib
from io import BytesIO
from pathlib import Path
from typing import ClassVar
from unittest.mock import patch

import canary_smoke
import pytest

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


def test_canary_carries_no_server_side_oauth_config() -> None:
    config = tomllib.loads((ROOT / "fly.canary.toml").read_text())
    environment = config["env"]
    assert not [
        name
        for name in environment
        if name.startswith(("ZIG_OAUTH_", "ZIG_AUTH_", "AUTH_"))
    ]
    workflow = (ROOT.parents[1] / ".github/workflows/deploy-next.yml").read_text()
    assert "ZIG_OAUTH_CLIENT_PRIVATE_KEY" not in workflow
    assert "ZIG_AUTH_ENCRYPTION_KEY" not in workflow


def test_read_only_boundary_has_no_session_routes() -> None:
    not_found = _response(
        {
            "error": {
                "code": "not_found",
                "message": "The requested resource was not found.",
                "request_id": "req-test",
            }
        },
        status=404,
    )
    seen: list[tuple[str, str]] = []

    def request(_: str, path: str, *, method: str = "GET") -> canary_smoke.Response:
        seen.append((path, method))
        if path == "/v1/actors/did:plc:canarysmoke/likes":
            return _response({"object": "list", "data": [], "next_cursor": None})
        return not_found

    with patch.object(canary_smoke, "_request", side_effect=request):
        canary_smoke._verify_read_only_boundary("https://canary.example")
    assert ("/v1/tracks/trk_smoke/like", "PUT") in seen


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


def test_sustained_play_reuses_one_durable_occurrence_receipt() -> None:
    occurrence = "01234567-89ab-4def-8123-456789abcdef"
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
                    "occurrence": occurrence,
                    "sources": {
                        "metrics": "application_metrics",
                        "dedup": "postgres_durable",
                    },
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
                    "occurrence": occurrence,
                    "sources": {
                        "metrics": "application_metrics",
                        "dedup": "postgres_durable",
                    },
                    "track_id": "trk_verified",
                    "record": track["record"],
                    "play_count": 8,
                    "counted": True,
                    "dedup": {"status": "duplicate", "window_seconds": 180},
                },
            ),
        )
    )

    with (
        patch.object(canary_smoke.uuid, "uuid4", return_value=occurrence) as uuid4,
        patch.object(canary_smoke, "_request", side_effect=responses) as request,
    ):
        canary_smoke._verify_sustained_play("https://canary.example", track)

    uuid4.assert_called_once_with()
    first_call, duplicate_call = request.call_args_list
    assert (
        first_call.args
        == duplicate_call.args
        == (
            "https://canary.example",
            f"/v1/tracks/trk_verified/plays?occurrence={occurrence}",
        )
    )
    assert first_call.kwargs == {"method": "POST"}
    assert duplicate_call.kwargs == {
        "method": "POST",
        "cookie": "plyr_play_id=abcdefghijklmnopqrstuv",
    }


@pytest.mark.parametrize(
    ("response_index", "field", "value"),
    [
        (0, "sources", {"metrics": "application_metrics", "dedup": "redis_ephemeral"}),
        (1, "counted", False),
        (1, "play_count", 9),
    ],
)
def test_sustained_play_rejects_obsolete_or_changed_receipts(
    response_index: int, field: str, value: object
) -> None:
    occurrence = "01234567-89ab-4def-8123-456789abcdef"
    track = {
        "id": "trk_verified",
        "record": {"uri": "at://did:plc:artist/fm.plyr.track/one"},
        "metrics": {"play_count": 7},
    }
    receipt = {
        "object": "play_receipt",
        "occurrence": occurrence,
        "track_id": track["id"],
        "record": track["record"],
        "counted": True,
        "play_count": 8,
        "sources": {"metrics": "application_metrics", "dedup": "postgres_durable"},
    }
    first = {**receipt, "dedup": {"status": "claimed"}}
    duplicate = {**receipt, "dedup": {"status": "duplicate"}}
    bodies = [first, duplicate]
    bodies[response_index][field] = value
    responses = [
        canary_smoke.Response(
            200,
            {"x-request-id": "first", "set-cookie": "plyr_play_id=test; Secure"},
            first,
        ),
        canary_smoke.Response(200, {"x-request-id": "second"}, duplicate),
    ]
    with (
        patch.object(canary_smoke.uuid, "uuid4", return_value=occurrence),
        patch.object(canary_smoke, "_request", side_effect=responses),
        pytest.raises(AssertionError),
    ):
        canary_smoke._verify_sustained_play("https://canary.example", track)


def test_product_only_transport_does_not_probe_infrastructure_routes() -> None:
    api = _response({"object": "api", "version": "v1"})

    with (
        patch.object(canary_smoke, "_request", return_value=api) as request,
        patch.object(
            canary_smoke,
            "_verify_real_product_reads",
            side_effect=RuntimeError("stop after transport assertion"),
        ) as reads,
        patch.object(canary_smoke, "_verify_read_only_boundary") as auth,
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
