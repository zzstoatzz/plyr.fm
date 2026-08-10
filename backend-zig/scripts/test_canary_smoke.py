"""Contract tests for the post-deploy canary traversal."""

import json
from io import BytesIO
from typing import ClassVar
from unittest.mock import patch

import canary_smoke


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
    ):
        try:
            canary_smoke.verify_product("https://api.next.plyr.fm/")
        except RuntimeError as error:
            assert str(error) == "stop after transport assertion"
        else:
            raise AssertionError("product verification unexpectedly continued")

    request.assert_called_once_with("https://api.next.plyr.fm", "/v1")
    reads.assert_called_once_with("https://api.next.plyr.fm")
