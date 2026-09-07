"""Musician-owned publishing and curation with durable upload reservations."""

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Self

import httpx

from studio.state import Store

API = "https://api.plyr.fm"


def credentials(name: str) -> str:
    result = subprocess.run(
        ["sops", "-d", "--output-type", "json", os.environ["STUDIO_CREDENTIALS_FILE"]],
        capture_output=True,
        check=True,
        timeout=30,
    )
    return json.loads(result.stdout)[name]["plyr_token"]


class Platform:
    def __init__(
        self, token: str, *, transport: httpx.BaseTransport | None = None
    ) -> None:
        self.client = httpx.Client(
            base_url=API,
            headers={"Authorization": "Bearer " + token},
            timeout=180,
            transport=transport,
        )

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_args: object) -> None:
        self.client.close()

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self.client.request(method, path, **kwargs)
        if response.status_code >= 400:
            raise RuntimeError(f"plyr.fm HTTP {response.status_code} on {path}")
        return response.json() if response.content else {}

    def playlist(self, name: str) -> str:
        title = f"{name} — listening"
        listings = self.request("GET", "/lists/playlists")
        for entry in listings:
            if entry["name"] == title:
                return entry["id"]
        return self.request("POST", "/lists/playlists", json={"name": title})["id"]

    def publish(self, store: Store, session: str, name: str, path: Path) -> int | None:
        study = store.study(session, name)
        if study.get("track_id"):
            return study["track_id"]
        if study.get("upload_id"):
            return self.finish_upload(store, session, name, study["upload_id"])
        if not store.claim_upload(session, name):
            return None
        with path.open("rb") as audio:
            response = self.request(
                "POST",
                "/tracks/",
                files={"file": (path.name, audio, "audio/wav")},
                data={
                    "title": study["title"],
                    "description": study["idea"],
                    "visibility": "unlisted",
                    "tags": json.dumps(["ai", "agent-musicians"]),
                    "self_labels": json.dumps(["ai-generated"]),
                },
            )
        store.save_study(session, name, {"upload_id": response["upload_id"]})
        return self.finish_upload(store, session, name, response["upload_id"])

    def finish_upload(
        self, store: Store, session: str, name: str, upload_id: str
    ) -> int:
        with self.client.stream(
            "GET", f"/tracks/uploads/{upload_id}/progress"
        ) as response:
            if response.status_code >= 400:
                raise RuntimeError(f"Upload progress HTTP {response.status_code}")
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                event = json.loads(line[6:])
                if event.get("status") == "failed":
                    store.save_study(session, name, {"upload_failed": True})
                    raise RuntimeError(
                        "Audio processing failed; daily attempt remains reserved"
                    )
                if event.get("status") == "completed":
                    track = self.request("GET", f"/tracks/{event['track_id']}")
                    if (
                        track["visibility"] != "unlisted"
                        or "ai-generated" not in track["self_labels"]
                    ):
                        raise RuntimeError(
                            "Upload visibility or disclosure verification failed"
                        )
                    store.save_study(session, name, {"track_id": track["id"]})
                    return track["id"]
        raise RuntimeError("Upload progress ended without a terminal result")

    def curate(self, playlist_id: str, track_id: int) -> bool:
        playlist = self.request("GET", f"/lists/playlists/{playlist_id}")
        if any(track["id"] == track_id for track in playlist["tracks"]):
            return False
        if len(playlist["tracks"]) >= 30:
            return False
        track = self.request("GET", f"/tracks/{track_id}")
        self.request(
            "POST",
            f"/lists/playlists/{playlist_id}/tracks",
            json={
                "track_uri": track["atproto_record_uri"],
                "track_cid": track["atproto_record_cid"],
            },
        )
        return True
