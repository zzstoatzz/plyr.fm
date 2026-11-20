"""Post-deploy semantic smoke test for the scoped Zig canary surface."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Response:
    status: int
    headers: dict[str, str]
    body: dict[str, Any]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_: Any, **__: Any) -> None:
        return None


X = "/xrpc/fm.plyr.unspecced."


def _q(value: str) -> str:
    return urllib.parse.quote(value, safe="")


def _request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    cookie: str | None = None,
    origin: str | None = None,
    follow_redirects: bool = True,
) -> Response:
    headers = {
        "Accept": "application/json",
        "User-Agent": "plyr-zig-canary-smoke/1",
    }
    if cookie:
        headers["Cookie"] = cookie
    if origin:
        headers["Origin"] = origin
    request = urllib.request.Request(
        f"{base_url}{path}", headers=headers, method=method
    )
    try:
        response = (
            urllib.request.urlopen(request, timeout=15)
            if follow_redirects
            else urllib.request.build_opener(_NoRedirect()).open(request, timeout=15)
        )
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


def _verify_read_only_boundary(base_url: str) -> None:
    """The appview holds no sessions: clients write to their own PDS."""
    for path, method in (
        ("/oauth-client-metadata.json", "GET"),
        ("/auth/me", "GET"),
        ("/auth/start?handle=alice.example", "GET"),
        ("/v1", "GET"),
        ("/v1/tracks?limit=1", "GET"),
        ("/v1/me/likes", "GET"),
        ("/v1/tracks/trk_smoke/like", "PUT"),
    ):
        gone = _request(base_url, path, method=method)
        assert gone.status == 404, (path, method, gone.status, gone.body)
        _expect_request_id(gone)

    likes = _request(base_url, X + "getActorLikes?actor=did:plc:canarysmoke")
    assert likes.status == 200, (likes.status, likes.body)
    assert likes.body["object"] == "list" and likes.body["data"] == [], likes.body
    _expect_request_id(likes)


def _verify_real_product_reads(base_url: str) -> dict[str, Any]:
    tracks = _request(base_url, X + "listTracks?limit=20")
    assert tracks.status == 200, (tracks.status, tracks.body)
    assert tracks.body["object"] == "list"
    data = tracks.body["data"]
    assert isinstance(data, list) and data, "next projection has no public tracks"
    _expect_request_id(tracks)

    listed_track: dict[str, Any] | None = None
    playback: Response | None = None
    for candidate in data:
        candidate_uri = _q(candidate["record"]["uri"])
        candidate_playback = _request(base_url, f"{X}getPlayback?uri={candidate_uri}")
        if candidate_playback.status == 401:
            assert candidate_playback.body["error"] == "AuthenticationRequired", (
                candidate_playback.body
            )
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

    track_uri = _q(listed_track["record"]["uri"])
    detail = _request(base_url, f"{X}getTrack?uri={track_uri}")
    assert detail.status == 200, (detail.status, detail.body)
    _expect_request_id(detail)
    listed_metadata = listed_track["metadata"]
    tags = detail.body["metadata"]["tags"]
    assert listed_metadata.get("tags") is None, listed_metadata
    assert isinstance(tags, list) and all(
        isinstance(tag, str) and tag for tag in tags
    ), detail.body
    expected_detail = {
        **listed_track,
        "metadata": {**listed_metadata, "tags": tags},
    }
    assert detail.body == expected_detail, (detail.body, expected_detail)

    artist_did = listed_track["artist"]["did"]
    encoded_did = urllib.parse.quote(artist_did, safe="")
    artist = _request(base_url, f"{X}getArtist?actor={encoded_did}")
    assert artist.status == 200, (artist.status, artist.body)
    _expect_request_id(artist)
    assert artist.body["object"] == "artist", artist.body
    assert artist.body["did"] == artist_did, artist.body

    metrics = _request(base_url, f"{X}getArtistMetrics?actor={encoded_did}")
    assert metrics.status == 200, (metrics.status, metrics.body)
    _expect_request_id(metrics)
    assert metrics.body["object"] == "artist_metrics", metrics.body
    assert metrics.body["artist_did"] == artist_did, metrics.body
    totals = metrics.body["totals"]
    assert all(
        isinstance(totals[field], int) and totals[field] >= 0
        for field in ("plays", "tracks", "duration_seconds")
    ), metrics.body
    assert totals["tracks"] >= 1, metrics.body
    assert metrics.body["sources"] == {
        "catalog": "verified_repo",
        "duration": "verified_repo",
        "plays": "application_metrics",
    }, metrics.body
    assert metrics.body["projection"] == {"verification": "verified_repo"}, metrics.body
    top_track = metrics.body["top_track"]
    assert isinstance(top_track, dict), metrics.body
    assert top_track["id"].startswith("trk_"), top_track
    assert top_track["record"]["uri"].startswith(f"at://{artist_did}/"), top_track
    assert isinstance(top_track["play_count"], int) and top_track["play_count"] >= 0

    search_query = urllib.parse.quote(listed_track["metadata"]["title"], safe="")
    search = _request(
        base_url,
        f"{X}search?q={search_query}&types=track&limit=10",
    )
    assert search.status == 200, (search.status, search.body)
    _expect_request_id(search)
    assert search.body["object"] == "list", search.body
    assert search.body["query"] == listed_track["metadata"]["title"], search.body
    search_hits = search.body["data"]
    matching_hits = [hit for hit in search_hits if hit["id"] == listed_track["id"]]
    assert len(matching_hits) == 1, (search.body, listed_track)
    search_hit = matching_hits[0]
    assert search_hit["record"]["uri"] == listed_track["record"]["uri"], search_hit
    assert search_hit["record"]["cid"] == listed_track["record"]["cid"], search_hit
    assert search_hit["sources"]["record"] == "verified_repo", search_hit
    assert search_hit["projection"]["verification"] == "verified_repo", search_hit
    assert "score" not in search_hit and "relevance" not in search_hit, search_hit

    albums = _request(base_url, f"{X}listAlbums?artistDid={encoded_did}&limit=1")
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
        album_uri = _q(album_data[0]["record"]["uri"])
        album = _request(base_url, f"{X}getAlbum?uri={album_uri}")
        assert album.status == 200, (album.status, album.body)
        _expect_request_id(album)
        assert album.body["object"] == "album", album.body
        assert album.body["id"] == album_data[0]["id"], album.body

    playlists = _request(base_url, X + "listPlaylists?limit=1")
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
    playlist_uri = _q(playlist_summary["record"]["uri"])
    playlist = _request(base_url, f"{X}getPlaylist?uri={playlist_uri}")
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
            record = member["track"]["record"]
            # the track record carries revision/collection/rkey too; the
            # member's subject is a strongRef, so compare only uri + cid.
            assert {"uri": record["uri"], "cid": record["cid"]} == member["subject"], (
                member
            )
        else:
            assert member["track"] is None, member
    return listed_track


def _verify_sustained_play(base_url: str, track: dict[str, Any]) -> None:
    occurrence = str(uuid.uuid4())
    path = f"{X}recordPlay?uri={_q(track['record']['uri'])}&occurrence={occurrence}"
    first = _request(base_url, path, method="POST")
    assert first.status == 200, (first.status, first.body)
    _expect_request_id(first)
    assert first.body["object"] == "play_receipt", first.body
    assert first.body["occurrence"] == occurrence, first.body
    assert first.body["track_id"] == track["id"], first.body
    assert first.body["record"]["uri"] == track["record"]["uri"], first.body
    assert first.body["counted"] is True, first.body
    assert first.body["dedup"]["status"] == "claimed", first.body
    assert first.body["sources"] == {
        "metrics": "application_metrics",
        "dedup": "postgres_durable",
    }, first.body
    assert first.body["play_count"] >= track["metrics"]["play_count"] + 1, first.body
    cookie = first.headers.get("set-cookie", "").split(";", 1)[0]
    assert cookie.startswith("plyr_play_id="), first.headers

    duplicate = _request(base_url, path, method="POST", cookie=cookie)
    assert duplicate.status == 200, (duplicate.status, duplicate.body)
    _expect_request_id(duplicate)
    assert duplicate.body["track_id"] == track["id"], duplicate.body
    assert duplicate.body["occurrence"] == occurrence, duplicate.body
    assert duplicate.body["counted"] is True, duplicate.body
    assert duplicate.body["dedup"]["status"] == "duplicate", duplicate.body
    assert duplicate.body["play_count"] == first.body["play_count"], duplicate.body
    assert duplicate.body["sources"] == first.body["sources"], duplicate.body
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


def verify_product(api_base_url: str) -> None:
    """Verify the XRPC reads through either Fly or next's narrow transport."""

    api_base_url = api_base_url.rstrip("/")
    _expect(
        _request(api_base_url, "/"),
        200,
        {"name": "plyr.fm", "api": "/xrpc"},
    )
    _verify_read_only_boundary(api_base_url)
    track = _verify_real_product_reads(api_base_url)
    _verify_sustained_play(api_base_url, track)

    absent_did = "did:plc:canarysmoke"
    artist = _request(api_base_url, f"{X}getArtist?actor={_q(absent_did)}")
    assert artist.status == 404 and artist.body["error"] == "NotFound", artist.body
    _expect_request_id(artist)

    albums = _request(api_base_url, f"{X}listAlbums?artistDid={_q(absent_did)}&limit=1")
    assert albums.status == 200, (albums.status, albums.body)
    assert albums.body["object"] == "list" and albums.body["data"] == []

    track_uri = _q(f"at://{absent_did}/fm.plyr.track/smoke")
    track = _request(api_base_url, f"{X}getTrack?uri={track_uri}")
    assert track.status == 404 and track.body["error"] == "NotFound", track.body
    playback = _request(api_base_url, f"{X}getPlayback?uri={track_uri}")
    assert playback.status == 404 and playback.body["error"] == "NotFound"

    album_uri = _q(f"at://{absent_did}/fm.plyr.list/smoke")
    album = _request(api_base_url, f"{X}getAlbum?uri={album_uri}")
    assert album.status == 404 and album.body["error"] == "NotFound", album.body


def verify(base_url: str, timeout_seconds: float = 90) -> None:
    base_url = base_url.rstrip("/")
    _wait_for_product_readiness(base_url, timeout_seconds)
    _expect(_request(base_url, "/health"), 200, {"status": "ok", "role": "api"})
    verify_product(base_url)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url")
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument(
        "--product-only",
        action="store_true",
        help="verify the reads without requiring infrastructure health routes",
    )
    parser.add_argument("--allow-http", action="store_true")
    args = parser.parse_args()
    if not args.allow_http and not args.base_url.startswith("https://"):
        parser.error("canary base URL must use HTTPS")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    if args.product_only:
        verify_product(args.base_url)
    else:
        verify(args.base_url, args.timeout)
    print(json.dumps({"status": "ok", "base_url": args.base_url.rstrip("/")}))


if __name__ == "__main__":
    main()
