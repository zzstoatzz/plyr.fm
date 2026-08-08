"""Black-box contract smoke test for the Zig HTTP boundary."""

from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
COLLECTION = "fm.plyr.dev.track"
ALLOWED_ORIGIN = "https://client.example"


def _unused_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _track_id(uri: str) -> str:
    payload = base64.urlsafe_b64encode(uri.encode()).decode().rstrip("=")
    return f"trk_{payload}"


def _request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    origin: str | None = None,
) -> tuple[int, dict[str, str], dict[str, Any]]:
    headers = {"Origin": origin} if origin else {}
    request = urllib.request.Request(
        f"{base_url}{path}", headers=headers, method=method
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


def _assert_connection_backpressure(port: int) -> None:
    blockers = [socket.create_connection(("127.0.0.1", port)) for _ in range(2)]
    queued = socket.create_connection(("127.0.0.1", port))
    try:
        time.sleep(0.05)
        queued.sendall(
            b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        )
        queued.settimeout(0.1)
        try:
            queued.recv(1)
        except TimeoutError:
            pass
        else:
            raise AssertionError("connection limit accepted a third active handler")

        blockers[0].close()
        blockers = blockers[1:]
        queued.settimeout(1)
        assert b"HTTP/1.1 200" in queued.recv(4096)
    finally:
        queued.close()
        for blocker in blockers:
            blocker.close()


def main() -> None:
    port = _unused_port()
    base_url = f"http://127.0.0.1:{port}"
    environment = {
        **os.environ,
        "MODE": "api",
        "PORT": str(port),
        "TRACK_COLLECTION_NSID": COLLECTION,
        "INDEX_MODE": "disabled",
        "MAX_CONNECTIONS": "2",
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
        _assert_connection_backpressure(port)

        status, _, api = _request(base_url, "/v1")
        assert status == 200 and api == {"object": "api", "version": "v1"}

        status, _, readiness = _request(base_url, "/ready")
        assert status == 503 and readiness["error"]["code"] == "service_unavailable"

        status, _, unavailable_list = _request(base_url, "/v1/tracks?limit=2")
        assert status == 503
        assert unavailable_list["error"]["code"] == "service_unavailable"

        status, _, list_method = _request(base_url, "/v1/tracks", method="POST")
        assert status == 405
        assert list_method["error"]["code"] == "method_not_allowed"

        for invalid_target in (
            "/v1/tracks?limit=0",
            "/v1/tracks?limit=101",
            "/v1/tracks?cursor=not-a-cursor",
            "/v1/tracks?artist_did=not-a-did",
            "/v1/tracks?artist_did=did%3Xplc",
            "/v1/tracks?artist_did=did:plc:a&artist_did=did:plc:b",
            "/v1/tracks?offset=10",
        ):
            status, _, invalid_list = _request(base_url, invalid_target)
            assert status == 400
            assert invalid_list["error"]["code"] == "invalid_request"

        status, _, unavailable_artist_tracks = _request(
            base_url, "/v1/tracks?artist_did=did%3Aplc%3Aartist&limit=5"
        )
        assert status == 503
        assert unavailable_artist_tracks["error"]["code"] == "service_unavailable"

        status, _, invalid = _request(base_url, "/v1/tracks/42")
        assert status == 400 and invalid["error"]["code"] == "invalid_request"

        status, _, invalid_artist = _request(base_url, "/v1/artists/not-an-identifier")
        assert status == 400
        assert invalid_artist["error"]["code"] == "invalid_request"

        for identifier in ("did:plc:artist", "Artist.Example"):
            status, _, unavailable_artist = _request(
                base_url, f"/v1/artists/{identifier}"
            )
            assert status == 503
            assert unavailable_artist["error"]["code"] == "service_unavailable"

        status, _, artist_method = _request(
            base_url, "/v1/artists/did:plc:artist", method="POST"
        )
        assert status == 405
        assert artist_method["error"]["code"] == "method_not_allowed"

        uri = f"at://did:plc:artist/{COLLECTION}/3m123abc"
        status, headers, unavailable = _request(
            base_url,
            f"/v1/tracks/{_track_id(uri)}",
            origin=ALLOWED_ORIGIN,
        )
        assert status == 503
        assert unavailable["error"]["code"] == "service_unavailable"
        assert headers["access-control-allow-origin"] == ALLOWED_ORIGIN
        assert headers["x-request-id"] == unavailable["error"]["request_id"]

        status, headers, _ = _request(
            base_url,
            f"/v1/tracks/{_track_id(uri)}",
            origin="https://client.example.attacker.test",
        )
        assert status == 503 and "access-control-allow-origin" not in headers

        foreign_uri = "at://did:plc:artist/fm.plyr.track/3m123abc"
        status, _, missing = _request(base_url, f"/v1/tracks/{_track_id(foreign_uri)}")
        assert status == 404 and missing["error"]["code"] == "not_found"

        status, _, method = _request(
            base_url, f"/v1/tracks/{_track_id(uri)}", method="POST"
        )
        assert status == 405 and method["error"]["code"] == "method_not_allowed"
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


if __name__ == "__main__":
    main()
