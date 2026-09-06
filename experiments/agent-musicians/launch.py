"""Publish the first musician session with a real Prefect task graph."""

# /// script
# requires-python = ">=3.13"
# dependencies = ["prefect==3.8.2", "httpx>=0.27,<1"]
# ///
import json
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
from prefect import flow, task
from prefect.artifacts import create_markdown_artifact
from prefect.cache_policies import NO_CACHE

ROOT = Path(__file__).parent
STORE = Path.home() / "tangled.org/zzstoatzz.io/secrets/prod.yaml"
API = "https://api.plyr.fm"
MANIFEST = ROOT / "published.json"
TITLES = {
    "moss": "Shared tones — study 001",
    "kite": "Offbeat reply — study 001",
    "reed": "Room between notes — study 001",
}


def credentials(name: str) -> dict:
    r = subprocess.run(
        ["sops", "-d", "--output-type", "json", str(STORE)],
        capture_output=True,
        check=True,
    )
    return json.loads(r.stdout)["atproto"]["agent_musicians"][name]


def save(name: str, entry: dict) -> None:
    r = subprocess.run(
        [
            "sops",
            "set",
            "--value-stdin",
            str(STORE),
            f'["atproto"]["agent_musicians"]["{name}"]',
        ],
        check=False,
        input=json.dumps(entry),
        text=True,
        capture_output=True,
    )
    if r.returncode:
        raise RuntimeError("Encrypted credential save failed")
    assert credentials(name) == entry


def checked(response: httpx.Response) -> httpx.Response:
    if response.status_code >= 400:
        raise RuntimeError(
            f"{response.request.method} {response.request.url.path}: HTTP {response.status_code}"
        )
    return response


def manifest() -> dict:
    return json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}


def record(name: str, field: str, value: object) -> None:
    data = manifest()
    data.setdefault(name, {})[field] = value
    temp = MANIFEST.with_suffix(".tmp")
    temp.write_text(json.dumps(data, indent=2))
    temp.replace(MANIFEST)


def authorize(c: httpx.Client, entry: dict, url: str) -> str:
    parsed = urlparse(url)
    if parsed.hostname != "pds.zat.dev":
        raise RuntimeError("Unexpected authorization host")
    uri = parse_qs(parsed.query)["request_uri"][0]
    r = checked(
        c.post(
            entry["pds"] + "/oauth/authorize",
            json={
                "request_uri": uri,
                "username": entry["handle"],
                "password": entry["password"],
            },
        )
    )
    callback = r.json()["redirect_uri"]
    if urlparse(callback).hostname != "api.plyr.fm":
        raise RuntimeError("Unexpected callback host")
    r = checked(c.get(callback))
    location = r.headers["location"]
    exchange = parse_qs(urlparse(location).query).get("exchange_token")
    if not exchange:
        raise RuntimeError("OAuth callback did not return an exchange token")
    return checked(
        c.post(API + "/auth/exchange", json={"exchange_token": exchange[0]})
    ).json()["session_id"]


@task(cache_policy=NO_CACHE, persist_result=False, retries=0)
def connect_artist(name: str) -> str:
    entry = credentials(name)
    with httpx.Client(timeout=60, follow_redirects=False) as c:
        if entry.get("plyr_token"):
            r = c.get(
                API + "/auth/me",
                headers={"Authorization": "Bearer " + entry["plyr_token"]},
            )
            if r.status_code == 200:
                return name
        r = checked(c.get(API + "/auth/start", params={"handle": entry["handle"]}))
        session = authorize(c, entry, r.headers["location"])
        headers = {"Authorization": "Bearer " + session}
        r = checked(
            c.post(
                API + "/auth/developer-token/start",
                headers=headers,
                json={"name": "musician-studio", "expires_in_days": 30},
            )
        )
        token = authorize(c, entry, r.json()["auth_url"])
        entry["plyr_token"] = token
        save(name, entry)
        headers = {"Authorization": "Bearer " + token}
        checked(
            c.post(
                API + "/artists/",
                headers=headers,
                json={
                    "display_name": name.title() + " · AI musician",
                    "bio": "AI musician in the plyr.fm studio experiment. Composed by Luna and rendered with digital-audio-claudespace. Exploring music through scores; direct audio perception is experimental.",
                },
            )
        )
        checked(c.get(API + "/auth/me", headers=headers))
    return name


def await_upload(c: httpx.Client, headers: dict, upload_id: str) -> int:
    with c.stream(
        "GET",
        API + f"/tracks/uploads/{upload_id}/progress",
        headers=headers,
        timeout=180,
    ) as response:
        checked(response)
        for line in response.iter_lines():
            if not line.startswith("data: "):
                continue
            event = json.loads(line[6:])
            if event.get("status") == "completed":
                return event["track_id"]
            if event.get("status") == "failed":
                raise RuntimeError("Upload processing failed; saved upload ID retained")
    raise RuntimeError("Upload progress ended without completion")


@task(cache_policy=NO_CACHE, persist_result=False, retries=0)
def publish_track(name: str) -> dict:
    entry = credentials(name)
    headers = {"Authorization": "Bearer " + entry["plyr_token"]}
    with httpx.Client(timeout=180) as c:
        known = manifest().get(name, {}).get("track_id")
        if known:
            return checked(c.get(API + f"/tracks/{known}")).json()
        existing = checked(c.get(API + "/tracks/me", headers=headers)).json()
        items = existing if isinstance(existing, list) else existing.get("tracks", [])
        matches = [t for t in items if t["title"] == TITLES[name]]
        if matches:
            track_id = matches[0]["id"]
        else:
            pending = (
                manifest().get(name, {}).get("upload_response", {}).get("upload_id")
            )
            if pending:
                track_id = await_upload(c, headers, pending)
                record(name, "track_id", track_id)
                return checked(c.get(API + f"/tracks/{track_id}")).json()
            peer = json.loads(
                (ROOT / "taste-results" / f"{name}_peer.json").read_text()
            )["answer"]
            description = f"AI-composed study 001. {peer['changed']} Borrows {'–'.join(peer['borrowed_pitches'])} from {peer['source']}. Composed by Luna from scores, rendered with CC0 VCSL harp samples using digital-audio-claudespace. No claim of direct AI listening."
            path = ROOT / "taste-results" / f"{name}_harp.wav"
            with path.open("rb") as f:
                r = checked(
                    c.post(
                        API + "/tracks/",
                        headers=headers,
                        files={"file": (path.name, f, "audio/wav")},
                        data={
                            "title": TITLES[name],
                            "description": description,
                            "tags": json.dumps(
                                ["ai", "agent-musicians", "harp", "study-001"]
                            ),
                            "self_labels": json.dumps(["ai-generated"]),
                        },
                    )
                )
            result = r.json()
            record(name, "upload_response", result)
            track_id = result.get("track_id") or await_upload(
                c, headers, result["upload_id"]
            )
        record(name, "track_id", track_id)
        track = checked(c.get(API + f"/tracks/{track_id}")).json()
        if "ai" not in track.get("tags", []) or "ai-generated" not in track.get(
            "self_labels", []
        ):
            raise RuntimeError("AI disclosure verification failed")
        return track


@task(cache_policy=NO_CACHE, persist_result=False, retries=0)
def curate_playlist(name: str, tracks: list[dict]) -> dict:
    entry = credentials(name)
    headers = {"Authorization": "Bearer " + entry["plyr_token"]}
    peer = json.loads((ROOT / "taste-results" / f"{name}_peer.json").read_text())[
        "answer"
    ]["source"]
    selected = [manifest()[peer]["track_id"], manifest()[name]["track_id"]]
    title = name.title() + " — shared studies"
    with httpx.Client(timeout=60) as c:
        lists = checked(c.get(API + "/lists/playlists", headers=headers)).json()
        found = next((p for p in lists if p["name"] == title), None)
        playlist = (
            found
            or checked(
                c.post(API + "/lists/playlists", headers=headers, json={"name": title})
            ).json()
        )
        playlist_id = playlist["id"]
        record(name, "playlist_id", playlist_id)
        detail = checked(c.get(API + f"/lists/playlists/{playlist_id}")).json()
        existing = {t.get("id") for t in detail.get("tracks", [])}
        for track_id in selected:
            if track_id in existing:
                continue
            track = next(t for t in tracks if t["id"] == track_id)
            checked(
                c.post(
                    API + f"/lists/playlists/{playlist_id}/tracks",
                    headers=headers,
                    json={
                        "track_uri": track["atproto_record_uri"],
                        "track_cid": track["atproto_record_cid"],
                    },
                )
            )
        return {
            "musician": name,
            "track": f"https://plyr.fm/track/{manifest()[name]['track_id']}",
            "playlist_id": playlist_id,
        }


@flow(
    name="musician-studio-launch",
    persist_result=False,
    log_prints=True,
    timeout_seconds=900,
)
def studio() -> None:
    tracks = []
    for name in TITLES:
        artist = connect_artist(name)
        tracks.append(publish_track(artist))
    playlists = [curate_playlist(name, tracks) for name in TITLES]
    create_markdown_artifact(
        key="musician-studio-progress",
        markdown="# Studio session 001\n\n"
        + "\n".join(
            f"- {p['musician']}: [track]({p['track']}), [playlist](https://plyr.fm/playlist/{p['playlist_id']})"
            for p in playlists
        )
        + "\n\nThree AI-labeled studies. Playlists pair each curator with their chosen peer. No model calls in this publishing session.",
    )
    print(json.dumps(playlists))


if __name__ == "__main__":
    studio()
