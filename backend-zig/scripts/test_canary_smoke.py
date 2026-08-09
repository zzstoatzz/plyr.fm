"""Contract tests for the post-deploy canary traversal."""

from unittest.mock import patch

import canary_smoke


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


def test_real_product_reads_traverse_projected_track_and_artist() -> None:
    track = {
        "object": "track",
        "id": "trk_verified",
        "record": {"uri": "at://did:plc:artist/fm.plyr.track/one", "cid": "bafyrecord"},
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
        "record": {"uri": "at://did:plc:artist/fm.plyr.track/one", "cid": "bafyrecord"},
        "artist": {"did": "did:plc:artist"},
        "metrics": {"play_count": 0},
        "sources": {"record": "verified_repo", "metrics": "derived"},
        "projection": {"verification": "verified_repo"},
    }
    album_summary = {"object": "album", "id": "alb_verified"}
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
