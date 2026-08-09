"""Post-deploy semantic smoke test for the read-only Zig canary."""

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


def _request(base_url: str, path: str) -> Response:
    request = urllib.request.Request(f"{base_url}{path}", method="GET")
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

    tracks = _request(base_url, "/v1/tracks?limit=1")
    assert tracks.status == 200, (tracks.status, tracks.body)
    assert tracks.body["object"] == "list"
    assert isinstance(tracks.body["data"], list)
    assert tracks.headers.get("x-request-id")

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
