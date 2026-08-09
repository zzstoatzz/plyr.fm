"""Post-deploy semantic smoke test for the scoped Zig canary surface."""

from __future__ import annotations

import argparse
import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Response:
    status: int
    headers: dict[str, str]
    body: dict[str, Any]


def _opaque_id(prefix: str, uri: str) -> str:
    payload = base64.urlsafe_b64encode(uri.encode()).decode().rstrip("=")
    return f"{prefix}{payload}"


def _request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    cookie: str | None = None,
) -> Response:
    headers = {"Accept": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    request = urllib.request.Request(
        f"{base_url}{path}", headers=headers, method=method
    )
    try:
        response = urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read()
        body = json.loads(raw) if raw else {}
        return Response(
            status=response.status,
            headers={key.lower(): value for key, value in response.headers.items()},
            body=body,
        )


def _expect(response: Response, status: int, body: dict[str, Any]) -> None:
    assert response.status == status, (response.status, response.body)
    assert response.body == body, response.body
    request_id = response.headers.get("x-request-id")
    assert request_id, response.headers
    if status >= 400:
        assert response.body["error"]["request_id"] == request_id


def _expect_request_id(response: Response) -> None:
    assert response.headers.get("x-request-id"), response.headers


def _verify_real_product_reads(base_url: str) -> dict[str, Any]:
    tracks = _request(base_url, "/v1/tracks?limit=20")
    assert tracks.status == 200, (tracks.status, tracks.body)
    assert tracks.body["object"] == "list"
    data = tracks.body["data"]
    assert isinstance(data, list) and data, "next projection has no public tracks"
    _expect_request_id(tracks)

    listed_track: dict[str, Any] | None = None
    playback: Response | None = None
    for candidate in data:
        candidate_id = urllib.parse.quote(candidate["id"], safe="_-")
        candidate_playback = _request(base_url, f"/v1/tracks/{candidate_id}/playback")
        if candidate_playback.status == 401:
            assert (
                candidate_playback.body["error"]["code"] == "authentication_required"
            ), candidate_playback.body
            continue
        assert candidate_playback.status == 200, (
            candidate_playback.status,
            candidate_playback.body,
        )
        if candidate_playback.body["availability"]["status"] == "available":
            listed_track = candidate
            playback = candidate_playback
            break
    assert listed_track is not None and playback is not None, (
        "projection has no anonymously playable track in its first page"
    )

    assert listed_track["object"] == "track", listed_track
    assert listed_track["projection"]["verification"] == "verified_repo", listed_track
    assert listed_track["sources"]["record"] == "verified_repo", listed_track
    assert listed_track["sources"]["metrics"] in {
        "application_metrics",
        "derived",
    }, listed_track
    assert isinstance(listed_track["metrics"]["play_count"], int), listed_track
    assert listed_track["metrics"]["play_count"] >= 0, listed_track

    _expect_request_id(playback)
    assert playback.body["object"] == "playback", playback.body
    assert playback.body["track_id"] == listed_track["id"], playback.body
    assert playback.body["record"]["uri"] == listed_track["record"]["uri"], (
        playback.body,
        listed_track,
    )
    assert playback.body["record"]["cid"] == listed_track["record"]["cid"], (
        playback.body,
        listed_track,
    )
    assert playback.body["authorization"] == {
        "audience": "anonymous",
        "status": "granted",
    }, playback.body
    delivery = playback.body["availability"]["delivery"]
    assert delivery["url"].startswith("https://"), delivery
    assert delivery["source"] in {"verified_delivery", "authored_record"}, delivery
    assert delivery["integrity"] in {"verified_blob_cid", "unverified"}, delivery

    track_id = urllib.parse.quote(listed_track["id"], safe="_-")
    detail = _request(base_url, f"/v1/tracks/{track_id}")
    assert detail.status == 200, (detail.status, detail.body)
    _expect_request_id(detail)
    assert detail.body == listed_track, (detail.body, listed_track)

    artist_did = listed_track["artist"]["did"]
    encoded_did = urllib.parse.quote(artist_did, safe="")
    artist = _request(base_url, f"/v1/artists/{artist_did}")
    assert artist.status == 200, (artist.status, artist.body)
    _expect_request_id(artist)
    assert artist.body["object"] == "artist", artist.body
    assert artist.body["did"] == artist_did, artist.body

    search_query = urllib.parse.quote(listed_track["metadata"]["title"], safe="")
    search = _request(
        base_url,
        f"/v1/search?q={search_query}&types=track&limit=10",
    )
    assert search.status == 200, (search.status, search.body)
    _expect_request_id(search)
    assert search.body["object"] == "list", search.body
    assert search.body["query"] == listed_track["metadata"]["title"], search.body
    search_hits = search.body["data"]
    matching_hits = [hit for hit in search_hits if hit["id"] == listed_track["id"]]
    assert len(matching_hits) == 1, (search.body, listed_track)
    search_hit = matching_hits[0]
    assert search_hit["record"] == listed_track["record"], search_hit
    assert search_hit["sources"]["record"] == "verified_repo", search_hit
    assert search_hit["projection"]["verification"] == "verified_repo", search_hit
    assert "score" not in search_hit and "relevance" not in search_hit, search_hit

    albums = _request(base_url, f"/v1/albums?artist_did={encoded_did}&limit=1")
    assert albums.status == 200, (albums.status, albums.body)
    _expect_request_id(albums)
    assert albums.body["object"] == "list", albums.body
    album_data = albums.body["data"]
    assert isinstance(album_data, list), albums.body
    if album_data:
        summary = album_data[0]
        assert summary["object"] == "album", summary
        assert summary["owner"]["did"] == artist_did, summary
        assert summary["projection"]["verification"] == "verified_repo", summary
        assert summary["sources"]["record"] == "verified_repo", summary
        assert "presentation" not in summary, summary
        album_id = urllib.parse.quote(album_data[0]["id"], safe="_-")
        album = _request(base_url, f"/v1/albums/{album_id}")
        assert album.status == 200, (album.status, album.body)
        _expect_request_id(album)
        assert album.body["object"] == "album", album.body
        assert album.body["id"] == album_data[0]["id"], album.body

    playlists = _request(base_url, "/v1/playlists?limit=1")
    assert playlists.status == 200, (playlists.status, playlists.body)
    _expect_request_id(playlists)
    assert playlists.body["object"] == "list", playlists.body
    playlist_data = playlists.body["data"]
    assert isinstance(playlist_data, list) and playlist_data, (
        "next projection has no public verified playlists"
    )
    playlist_summary = playlist_data[0]
    assert playlist_summary["object"] == "playlist", playlist_summary
    assert playlist_summary["sources"]["record"] == "verified_repo", playlist_summary
    assert playlist_summary["sources"]["membership"] == "verified_repo", (
        playlist_summary
    )
    playlist_id = urllib.parse.quote(playlist_summary["id"], safe="_-")
    playlist = _request(base_url, f"/v1/playlists/{playlist_id}")
    assert playlist.status == 200, (playlist.status, playlist.body)
    _expect_request_id(playlist)
    assert playlist.body["object"] == "playlist", playlist.body
    assert playlist.body["id"] == playlist_summary["id"], playlist.body
    assert playlist.body["record"] == playlist_summary["record"], (
        playlist.body,
        playlist_summary,
    )
    members = playlist.body["members"]
    assert isinstance(members, list), playlist.body
    assert playlist.body["metrics"]["member_count"] == len(members), playlist.body
    assert [member["position"] for member in members] == list(range(len(members))), (
        playlist.body
    )
    for member in members:
        assert member["availability"] in {"available", "unavailable"}, member
        if member["availability"] == "available":
            assert member["track"]["record"] == member["subject"], member
        else:
            assert member["track"] is None, member
    return listed_track


def _verify_sustained_play(base_url: str, track: dict[str, Any]) -> None:
    track_id = urllib.parse.quote(track["id"], safe="_-")
    path = f"/v1/tracks/{track_id}/plays"
    first = _request(base_url, path, method="POST")
    assert first.status == 200, (first.status, first.body)
    _expect_request_id(first)
    assert first.body["object"] == "play_receipt", first.body
    assert first.body["track_id"] == track["id"], first.body
    assert first.body["record"]["uri"] == track["record"]["uri"], first.body
    assert first.body["counted"] is True, first.body
    assert first.body["dedup"]["status"] == "claimed", first.body
    assert first.body["play_count"] >= track["metrics"]["play_count"] + 1, first.body
    cookie = first.headers.get("set-cookie", "").split(";", 1)[0]
    assert cookie.startswith("plyr_play_id="), first.headers

    duplicate = _request(base_url, path, method="POST", cookie=cookie)
    assert duplicate.status == 200, (duplicate.status, duplicate.body)
    _expect_request_id(duplicate)
    assert duplicate.body["track_id"] == track["id"], duplicate.body
    assert duplicate.body["counted"] is False, duplicate.body
    assert duplicate.body["dedup"]["status"] == "duplicate", duplicate.body
    assert duplicate.body["play_count"] >= first.body["play_count"], duplicate.body
    assert "set-cookie" not in duplicate.headers, duplicate.headers


def _wait_for_product_readiness(base_url: str, timeout_seconds: float) -> None:
    deadline = time.monotonic() + timeout_seconds
    last: object = "no response"
    while time.monotonic() < deadline:
        try:
            response = _request(base_url, "/ready")
            last = (response.status, response.body)
            if response.status == 200:
                _expect(
                    response,
                    200,
                    {"status": "ready", "index": "reachable"},
                )
                return
        except (OSError, TimeoutError) as error:
            last = error
        time.sleep(1)
    raise TimeoutError(f"canary did not become product-ready: {last}")


def verify(base_url: str, timeout_seconds: float = 90) -> None:
    base_url = base_url.rstrip("/")
    _wait_for_product_readiness(base_url, timeout_seconds)
    _expect(_request(base_url, "/health"), 200, {"status": "ok", "role": "api"})
    _expect(_request(base_url, "/v1"), 200, {"object": "api", "version": "v1"})
    track = _verify_real_product_reads(base_url)
    _verify_sustained_play(base_url, track)

    absent_did = "did:plc:canarysmoke"
    artist = _request(base_url, f"/v1/artists/{absent_did}")
    assert artist.status == 404 and artist.body["error"]["code"] == "not_found"
    assert artist.body["error"]["request_id"] == artist.headers.get("x-request-id")

    encoded_did = urllib.parse.quote(absent_did, safe="")
    albums = _request(base_url, f"/v1/albums?artist_did={encoded_did}&limit=1")
    assert albums.status == 200, (albums.status, albums.body)
    assert albums.body["object"] == "list" and albums.body["data"] == []

    track_uri = f"at://{absent_did}/fm.plyr.stg.track/smoke"
    track = _request(base_url, f"/v1/tracks/{_opaque_id('trk_', track_uri)}")
    assert track.status == 404 and track.body["error"]["code"] == "not_found"
    playback = _request(
        base_url, f"/v1/tracks/{_opaque_id('trk_', track_uri)}/playback"
    )
    assert playback.status == 404
    assert playback.body["error"]["code"] == "not_found"

    album_uri = f"at://{absent_did}/fm.plyr.stg.list/smoke"
    album = _request(base_url, f"/v1/albums/{_opaque_id('alb_', album_uri)}")
    assert album.status == 404 and album.body["error"]["code"] == "not_found"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--allow-http", action="store_true")
    args = parser.parse_args()
    if not args.allow_http and not args.base_url.startswith("https://"):
        parser.error("canary base URL must use HTTPS")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    verify(args.base_url, args.timeout)
    print(json.dumps({"status": "ok", "base_url": args.base_url.rstrip("/")}))


if __name__ == "__main__":
    main()
