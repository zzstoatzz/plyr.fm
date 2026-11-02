"""Assert exact-CID like reads through the public Zig HTTP boundary."""

from __future__ import annotations

import os
import subprocess

from test_http import _request, _track_id, _unused_port, _wait_until_ready

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACK_CID = "bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url or not database_url.endswith("/zig_bench"):
        raise RuntimeError("like contract requires the disposable zig_bench database")
    port = _unused_port()
    base_url = f"http://127.0.0.1:{port}"
    environment = {
        **os.environ,
        "MODE": "api",
        "PORT": str(port),
        "TRACK_COLLECTION_NSID": "fm.plyr.dev.track",
        "LIST_COLLECTION_NSID": "fm.plyr.dev.list",
        "PROFILE_COLLECTION_NSID": "fm.plyr.dev.actor.profile",
        "LIKE_COLLECTION_NSID": "fm.plyr.dev.like",
        "INDEX_MODE": "required",
        "DATABASE_POOL_SIZE": "4",
        "MAX_CONNECTIONS": "4",
    }
    process = subprocess.Popen(
        [os.path.join(ROOT, "zig-out/bin/plyr-backend")],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        _wait_until_ready(base_url, process)

        # track-1 has one current-CID like and 100 deliberately seeded stale-CID
        # likes. Only the strong reference to the current record is visible.
        track_one_uri = "at://did:plc:bench/fm.plyr.dev.track/track-1"
        status, _, body = _request(
            base_url, f"/v1/tracks/{_track_id(track_one_uri)}/likes?limit=10"
        )
        assert status == 200
        assert body["object"] == "list"
        assert len(body["data"]) == 1
        assert body["has_more"] is False and body["next_cursor"] is None
        assert body["data"][0]["subject"] == {
            "uri": track_one_uri,
            "cid": TRACK_CID,
        }
        assert body["data"][0]["sources"]["record"] == "verified_repo"
        status, _, track_one = _request(
            base_url, f"/v1/tracks/{_track_id(track_one_uri)}"
        )
        assert status == 200 and track_one["metrics"]["like_count"] == 1

        # A busy subject paginates with an opaque cursor scoped to this exact
        # URI + CID. Adjacent pages cannot repeat a record.
        track_hundred_uri = "at://did:plc:bench/fm.plyr.dev.track/track-100"
        path = f"/v1/tracks/{_track_id(track_hundred_uri)}/likes?limit=2"
        status, _, first = _request(base_url, path)
        assert status == 200 and len(first["data"]) == 2
        assert first["has_more"] is True and first["next_cursor"]
        assert all(item["subject"]["cid"] == TRACK_CID for item in first["data"])
        status, _, track_hundred = _request(
            base_url, f"/v1/tracks/{_track_id(track_hundred_uri)}"
        )
        assert status == 200 and track_hundred["metrics"]["like_count"] == 100
        status, _, second = _request(base_url, f"{path}&cursor={first['next_cursor']}")
        assert status == 200 and len(second["data"]) == 2
        first_uris = {item["record"]["uri"] for item in first["data"]}
        second_uris = {item["record"]["uri"] for item in second["data"]}
        assert first_uris.isdisjoint(second_uris)
    finally:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


if __name__ == "__main__":
    main()
