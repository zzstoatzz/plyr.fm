"""Black-box contract smoke test for the Zig HTTP boundary."""

from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from xrpc_contract import assert_xrpc_methods

ROOT = Path(__file__).resolve().parents[1]
COLLECTION = "fm.plyr.dev.track"
ALLOWED_ORIGIN = "https://client.example"
X = "/xrpc/fm.plyr.dev.unspecced."
ERRORS = {
    400: "InvalidRequest",
    404: "NotFound",
    405: "MethodNotAllowed",
    503: "ServiceUnavailable",
}


def _unused_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _track_id(uri: str) -> str:
    payload = base64.urlsafe_b64encode(uri.encode()).decode().rstrip("=")
    return f"trk_{payload}"


def _q(uri: str) -> str:
    return urllib.parse.quote(uri, safe="")


def _request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    origin: str | None = None,
    data: bytes | None = None,
) -> tuple[int, dict[str, str], dict[str, Any]]:
    headers = {"Origin": origin} if origin else {}
    request = urllib.request.Request(
        f"{base_url}{path}", headers=headers, method=method, data=data
    )
    try:
        response = urllib.request.urlopen(request, timeout=2)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read()
        body = json.loads(raw) if raw else {}
        response_headers = {
            key.lower(): value for key, value in response.headers.items()
        }
        return response.status, response_headers, body


def _expect(base_url: str, call: str, status: int, **kwargs: Any) -> None:
    """An unspecced method answers `status` with the matching XRPC error."""
    actual, _, body = _request(base_url, X + call, **kwargs)
    assert actual == status, (call, actual, body)
    if kwargs.get("method") != "HEAD":
        assert body.get("error") == ERRORS[status], (call, body)


def _wait_until_ready(base_url: str, process: subprocess.Popen[bytes]) -> None:
    for _ in range(100):
        if process.poll() is not None:
            stderr = process.stderr.read().decode() if process.stderr else ""
            raise RuntimeError(f"server exited before readiness:\n{stderr}")
        try:
            if _request(base_url, "/health")[0] == 200:
                return
        except OSError:
            time.sleep(0.02)
    raise TimeoutError("Zig API did not become ready")


def _assert_idle_connections_time_out(port: int) -> None:
    """Idle sockets must not wedge the API.

    The server runs with MAX_CONNECTIONS=2 and REQUEST_TIMEOUT_SECONDS=1. Two
    clients that connect and send nothing fill every slot; the server has to
    drop them on its own so a third, real request is still answered.
    """
    blockers = [socket.create_connection(("127.0.0.1", port)) for _ in range(2)]
    queued = socket.create_connection(("127.0.0.1", port))
    try:
        queued.sendall(
            b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        )
        queued.settimeout(5)
        assert b"HTTP/1.1 200" in queued.recv(4096)
        for blocker in blockers:
            blocker.settimeout(5)
            assert blocker.recv(1) == b"", "server kept an idle connection open"
    finally:
        queued.close()
        for blocker in blockers:
            blocker.close()


def _assert_partial_request_times_out(port: int) -> None:
    """A client that starts a request and stalls is dropped, not waited on."""
    with socket.create_connection(("127.0.0.1", port)) as stalled:
        stalled.sendall(b"GET /health HTTP/1.1\r\nHost: local")
        stalled.settimeout(5)
        started = time.monotonic()
        assert stalled.recv(4096) == b""
        assert time.monotonic() - started < 4


def main() -> None:
    port = _unused_port()
    base_url = f"http://127.0.0.1:{port}"
    environment = {
        **os.environ,
        "MODE": "api",
        "PORT": str(port),
        "TRACK_COLLECTION_NSID": COLLECTION,
        "LIST_COLLECTION_NSID": "fm.plyr.dev.list",
        "PROFILE_COLLECTION_NSID": "fm.plyr.dev.actor.profile",
        "LIKE_COLLECTION_NSID": "fm.plyr.dev.like",
        "INDEX_MODE": "disabled",
        "MAX_CONNECTIONS": "2",
        "REQUEST_TIMEOUT_SECONDS": "1",
        "CORS_ALLOWED_ORIGINS": ALLOWED_ORIGIN,
    }
    # This smoke test intentionally exercises the unavailable-index contract.
    # Never inherit a developer's staging or production database connection.
    environment.pop("DATABASE_URL", None)
    process = subprocess.Popen(
        [ROOT / "zig-out/bin/plyr-backend"],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        _wait_until_ready(base_url, process)
        _assert_idle_connections_time_out(port)
        _assert_partial_request_times_out(port)

        for payload in (None, b"", b"ignored"):
            status, headers, body = _request(
                base_url,
                X + "listTracks",
                method="HEAD",
                origin=ALLOWED_ORIGIN,
                data=payload,
            )
            assert status == 405 and body == {}
            # public reads answer any origin, without credentials
            assert headers["access-control-allow-origin"] == "*"
            assert "access-control-allow-credentials" not in headers
            assert headers["connection"].lower() == "close"
            assert _request(base_url, "/health")[0] == 200

        # a browser preflight before every JSON POST; an empty 204 once
        # crashed the process, so check it answers and the server survives
        for path, expected in (
            (X + "resolveArtists", "*"),
            (X + "listTracks", "*"),
            (X + "recordPlay", ALLOWED_ORIGIN),
            ("/health", ALLOWED_ORIGIN),
        ):
            status, headers, body = _request(
                base_url, path, method="OPTIONS", origin=ALLOWED_ORIGIN
            )
            assert status == 204 and body == {}
            assert headers["access-control-allow-origin"] == expected
            assert _request(base_url, "/health")[0] == 200

        # any website may preflight a public read, including the POST batch
        # reads; recordPlay carries the play cookie, so it stays exact
        stranger = "https://records.example"
        status, headers, _ = _request(
            base_url, X + "resolveTracks", method="OPTIONS", origin=stranger
        )
        assert status == 204 and headers["access-control-allow-origin"] == "*"
        assert "POST" in headers["access-control-allow-methods"]
        assert "access-control-allow-credentials" not in headers
        status, headers, _ = _request(
            base_url, X + "recordPlay", method="OPTIONS", origin=stranger
        )
        assert status == 204 and "access-control-allow-origin" not in headers

        assert_xrpc_methods(base_url, _request, COLLECTION)

        status, _, root = _request(base_url, "/")
        assert status == 200 and root == {"name": "plyr.fm", "api": "/xrpc"}

        status, _, readiness = _request(base_url, "/ready")
        assert status == 503 and readiness["error"]["code"] == "service_unavailable"

        # read-only appview: no oauth client, sessions, proxied writes, or /v1
        song_id = _track_id(f"at://did:plc:artist/{COLLECTION}/song")
        for gone_path, gone_method in (
            ("/oauth-client-metadata.json", "GET"),
            ("/auth/pds-options", "GET"),
            ("/auth/start?handle=artist.example", "GET"),
            ("/auth/logout", "POST"),
            ("/v1", "GET"),
            ("/v1/tracks", "GET"),
            (f"/v1/tracks/{song_id}", "GET"),
            ("/v1/me/likes", "GET"),
            ("/v1/actors/did:plc:artist/likes/resolve", "POST"),
            (f"/v1/tracks/{song_id}/like", "PUT"),
        ):
            status, _, gone = _request(base_url, gone_path, method=gone_method)
            assert status == 404, (gone_path, gone_method, status)
            assert gone["error"]["code"] == "not_found"

        _expect(base_url, "getStats", 503)
        _expect(base_url, "getStats", 405, method="POST", data=b"")
        _expect(base_url, "getActorLikes?actor=did:plc:artist", 503)
        _expect(base_url, "getActorLikes?actor=artist.example", 400)

        _expect(base_url, "listTracks?limit=2", 503)
        _expect(base_url, "listTracks", 405, method="POST")
        for invalid in (
            "listTracks?limit=0",
            "listTracks?limit=101",
            "listTracks?cursor=not-a-cursor",
            "listTracks?artistDid=not-a-did",
            "listTracks?artistDid=did%3Xplc",
            "listTracks?artistDid=did:plc:a&artistDid=did:plc:b",
            "listTracks?offset=10",
        ):
            _expect(base_url, invalid, 400)
        _expect(base_url, "listTracks?artistDid=did%3Aplc%3Aartist&limit=5", 503)

        for invalid in (
            "listAlbums",
            "listAlbums?artistDid=not-a-did",
            "listAlbums?artistDid=did:plc:artist&limit=0",
            "listAlbums?artistDid=did:plc:a&artistDid=did:plc:b",
        ):
            _expect(base_url, invalid, 400)
        _expect(base_url, "listAlbums?artistDid=did%3Aplc%3Aartist&limit=5", 503)
        _expect(base_url, "listAlbums?artistDid=did:plc:artist", 405, method="POST")

        album_uri = "at://did:plc:artist/fm.plyr.dev.list/album"
        _expect(base_url, "getAlbum?uri=42", 400)
        _expect(base_url, f"getAlbum?uri={_q(album_uri)}", 503)
        foreign_album = "at://did:plc:artist/fm.plyr.list/album"
        _expect(base_url, f"getAlbum?uri={_q(foreign_album)}", 404)
        _expect(base_url, f"getAlbum?uri={_q(album_uri)}", 405, method="POST")

        for invalid in (
            "listPlaylists?ownerDid=not-a-did",
            "listPlaylists?ownerDid=did:plc:owner&limit=0",
            "listPlaylists?ownerDid=did:plc:a&ownerDid=did:plc:b",
        ):
            _expect(base_url, invalid, 400)
        _expect(base_url, "listPlaylists?limit=5", 503)
        _expect(base_url, "listPlaylists?ownerDid=did%3Aplc%3Aowner&limit=5", 503)

        playlist_uri = "at://did:plc:owner/fm.plyr.dev.list/playlist"
        _expect(base_url, f"getPlaylist?uri={_q(playlist_uri)}", 503)
        foreign_playlist = "at://did:plc:owner/fm.plyr.list/playlist"
        _expect(base_url, f"getPlaylist?uri={_q(foreign_playlist)}", 404)
        _expect(base_url, f"getPlaylist?uri={_q(playlist_uri)}", 405, method="POST")

        _expect(base_url, "getTrack?uri=4x2", 400)
        _expect(base_url, "getTrack?legacyId=1667", 503)

        for method in ("getArtist", "getArtistMetrics"):
            _expect(base_url, f"{method}?actor=not-an-identifier", 400)
            for actor in ("did:plc:artist", "did%3Aplc%3Aartist", "Artist.Example"):
                _expect(base_url, f"{method}?actor={actor}", 503)
            _expect(base_url, f"{method}?actor=did:plc:artist", 405, method="POST")

        for invalid in (
            "search",
            "search?q=okay&q=again",
            "search?q=okay&types=track,track",
            "search?q=okay&types=tag",
            "search?q=okay&limit=0",
            "search?q=okay&limit=51",
            "search?q=okay&offset=1",
        ):
            _expect(base_url, invalid, 400)
        status, _, short_search = _request(base_url, X + "search?q=a")
        assert status == 200 and short_search["data"] == []
        _expect(base_url, "search?q=artist.example&types=artist,track&limit=10", 503)
        _expect(base_url, "search?q=artist.example", 405, method="POST")

        for target in (
            "getTags",
            "getTags?limit=100",
            "listTracks?tag=ambient&tag=drone",
        ):
            _expect(base_url, target, 503)
        for invalid in (
            "getTags?limit=0",
            "getTags?limit=101",
            "getTags?limit=2&limit=3",
            "getTags?offset=1",
            "listTracks?tag=",
            "listTracks?tag=bad%00tag",
            "listTracks?" + "&".join(f"tag={n}" for n in range(1, 12)),
        ):
            _expect(base_url, invalid, 400)
        _expect(base_url, "getTags", 405, method="POST")

        status, _, empty_artists = _request(
            base_url, X + "resolveArtists", method="POST", data=b'{"dids":[]}'
        )
        assert status == 200 and empty_artists["data"] == []
        for payload in (
            b'{"dids":["invalid"]}',
            b'{"dids":[],"extra":true}',
            json.dumps({"dids": ["did:plc:artist"] * 501}).encode(),
            b"x" * 65537,
        ):
            _expect(base_url, "resolveArtists", 400, method="POST", data=payload)
        artist_body = b'{"dids":["did:plc:artist"]}'
        _expect(base_url, "resolveArtists", 503, method="POST", data=artist_body)
        _expect(base_url, "resolveArtists", 405)

        status, _, empty_latest = _request(
            base_url, X + "resolveLatestTracks", method="POST", data=b'{"dids":[]}'
        )
        assert status == 200 and empty_latest["data"] == []
        for payload in (
            b'{"dids":["invalid"]}',
            b'{"dids":[],"extra":true}',
            b'{"dids":["did:plc:artist"],"limit":0}',
            b'{"dids":["did:plc:artist"],"limit":51}',
            json.dumps({"dids": ["did:plc:artist"] * 501}).encode(),
            b"x" * 65537,
        ):
            _expect(base_url, "resolveLatestTracks", 400, method="POST", data=payload)
        _expect(base_url, "resolveLatestTracks", 503, method="POST", data=artist_body)
        _expect(base_url, "resolveLatestTracks", 405)

        for invalid in (
            "getTrackChart?period=year",
            "getTrackChart?period=week&period=day",
            "getTrackChart?limit=0",
            "getTrackChart?limit=51",
            "getTrackChart?offset=1",
        ):
            _expect(base_url, invalid, 400)
        _expect(base_url, "getTrackChart?period=all_time&limit=10", 503)
        _expect(base_url, "getTrackChart", 405, method="POST")

        uri = _q(f"at://did:plc:artist/{COLLECTION}/3m123abc")
        status, headers, unavailable = _request(
            base_url, X + f"getTrack?uri={uri}", origin=ALLOWED_ORIGIN
        )
        assert status == 503 and unavailable["error"] == "ServiceUnavailable"
        assert headers["access-control-allow-origin"] == "*"
        assert headers["x-request-id"]
        status, headers, _ = _request(
            base_url,
            X + f"getTrack?uri={uri}",
            origin="https://client.example.attacker.test",
        )
        assert status == 503 and headers["access-control-allow-origin"] == "*"
        assert "access-control-allow-credentials" not in headers

        foreign = _q("at://did:plc:artist/fm.plyr.track/3m123abc")
        _expect(base_url, f"getTrack?uri={uri}", 405, method="POST")
        _expect(base_url, f"getPlayback?uri={uri}", 503)
        _expect(base_url, f"getPlayback?uri={uri}", 405, method="POST")

        likes = f"getTrackLikes?uri={uri}"
        _expect(base_url, likes, 503)
        _expect(base_url, likes, 405, method="POST")
        for invalid in (
            "getTrackLikes?uri=42",
            f"{likes}&limit=0",
            f"{likes}&limit=101",
            f"{likes}&limit=2&limit=3",
            f"{likes}&unknown=value",
        ):
            _expect(base_url, invalid, 400)

        play = f"recordPlay?uri={uri}"
        occurrence = "&occurrence=01234567-89ab-4def-8123-456789abcdef"
        _expect(base_url, play, 405)
        _expect(base_url, play + occurrence, 503, method="POST")
        for invalid in (
            "recordPlay?uri=42",
            f"{play}&ref=short",
            f"{play}&ref=share123&ref=again123",
            f"{play}&unknown=value",
        ):
            _expect(base_url, invalid, 400, method="POST")
        _expect(base_url, f"recordPlay?uri={foreign}{occurrence}", 404, method="POST")
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


if __name__ == "__main__":
    main()
