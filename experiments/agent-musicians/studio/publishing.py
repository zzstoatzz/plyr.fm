"""Bounded uploads and curation using each musician's own credential."""

import json
import os
import subprocess
from pathlib import Path

import httpx

from studio.models import Decision
from studio.state import Store

API = "https://api.plyr.fm"


def token(name: str) -> str:
    path = os.environ["STUDIO_CREDENTIALS_FILE"]
    result = subprocess.run(
        ["sops", "-d", "--output-type", "json", path],
        capture_output=True,
        check=True,
        timeout=30,
    )
    return json.loads(result.stdout)[name]["plyr_token"]


def checked(response: httpx.Response) -> httpx.Response:
    if response.status_code >= 400:
        raise RuntimeError(
            f"plyr.fm HTTP {response.status_code} on {response.request.url.path}"
        )
    return response


def publish(
    store: Store, session: str, name: str, path: Path, decision: Decision, study: dict
) -> int | None:
    if store.released_today(name, session[:10]):
        return None
    study["upload_attempted"] = True
    store.save_study(session, name, study)
    with httpx.Client(
        timeout=180, headers={"Authorization": "Bearer " + token(name)}
    ) as client:
        with path.open("rb") as audio:
            response = checked(
                client.post(
                    API + "/tracks/",
                    files={"file": (path.name, audio, "audio/wav")},
                    data={
                        "title": decision.title,
                        "description": f"{decision.changed}\nStudy with {study['peer_name']}. Score-based Luna composition, CC0 VCSL harp rendering.",
                        "tags": json.dumps(["ai", "agent-musicians", "harp"]),
                        "self_labels": json.dumps(["ai-generated"]),
                        "visibility": "unlisted",
                    },
                )
            ).json()
        study["upload_id"] = response["upload_id"]
        store.save_study(session, name, study)
        with client.stream(
            "GET", API + f"/tracks/uploads/{response['upload_id']}/progress"
        ) as progress:
            checked(progress)
            for line in progress.iter_lines():
                if not line.startswith("data: "):
                    continue
                event = json.loads(line[6:])
                if event.get("status") == "failed":
                    raise RuntimeError("Audio processing failed")
                if event.get("status") == "completed":
                    track_id = event["track_id"]
                    track = checked(client.get(API + f"/tracks/{track_id}")).json()
                    if (
                        track["visibility"] != "unlisted"
                        or "ai-generated" not in track["self_labels"]
                    ):
                        raise RuntimeError(
                            "Track disclosure or visibility verification failed"
                        )
                    study["track_id"] = track_id
                    store.save_study(session, name, study)
                    return track_id
    raise RuntimeError("Upload did not complete")


def curate(name: str, playlist_id: str, track_id: int) -> None:
    with httpx.Client(
        timeout=45, headers={"Authorization": "Bearer " + token(name)}
    ) as client:
        detail = checked(client.get(API + f"/lists/playlists/{playlist_id}")).json()
        if (
            any(t["id"] == track_id for t in detail["tracks"])
            or len(detail["tracks"]) >= 30
        ):
            return
        track = checked(client.get(API + f"/tracks/{track_id}")).json()
        checked(
            client.post(
                API + f"/lists/playlists/{playlist_id}/tracks",
                json={
                    "track_uri": track["atproto_record_uri"],
                    "track_cid": track["atproto_record_cid"],
                },
            )
        )
