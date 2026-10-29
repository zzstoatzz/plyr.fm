"""Owner-only protected album ZIP recovery against disposable staging fixtures."""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import re
import zipfile
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote, urlparse

from _protected_audio_smoke import audio, checked, headers, maintenance_machine

if TYPE_CHECKING:
    from smoke_protected_audio import Smoke


async def cleanup_zip(
    smoke: Smoke,
    album: dict[str, Any],
    track_id: int,
    job_id: str,
    path: str,
    archive_key: str | None,
) -> None:
    payload = json.dumps(
        {
            "album": album,
            "track_id": track_id,
            "job_id": job_id,
            "path": path,
            "archive_key": archive_key,
        }
    )
    script = f"""import asyncio, hashlib, json
import aioboto3
from backend.config import settings
from backend.models import Album, Track
from backend.models.job import Job
from backend.storage import storage
from backend.utilities.database import db_session, get_engine
from backend.utilities.downloads import download_filename, download_key
payload = json.loads({payload!r})
async def main():
    async with db_session() as db:
        album = await db.get(Album, payload["album"]["id"])
        track = await db.get(Track, payload["track_id"])
        job = await db.get(Job, payload["job_id"])
        assert album and track and job
        assert album.title == payload["album"]["title"]
        assert album.slug == payload["album"]["slug"]
        assert album.title.startswith("protected album smoke ")
        assert album.artist_did == track.artist_did == job.owner_did == payload["album"]["artist_did"]
        assert track.album_id == album.id and track.protected_audio
        assert job.type == "export" and job.status in ("completed", "failed")
        if job.status == "completed":
            assert job.result["download_url"] == payload["path"]
            assert job.result["total_count"] == 1
        key = download_key(file_id=track.file_id, file_type=track.file_type,
            original_file_id=track.original_file_id, original_file_type=track.original_file_type,
            r2_url=track.r2_url, audio_storage=track.audio_storage)
        assert key is not None
        entry = "01 " + download_filename(payload["album"]["artist"], track.title, key.extension)
        digest = hashlib.sha256(f"{{key.key}}|{{entry}}".encode()).hexdigest()[:16]
        r2_key = f"exports/albums/{{album.id}}-{{digest}}.zip"
        if payload["archive_key"] is not None:
            assert payload["archive_key"] == r2_key
        if job.status == "completed":
            assert await storage.object_exists(r2_key, private=True)
    async with aioboto3.Session().client("s3", endpoint_url=settings.storage.r2_endpoint_url,
        aws_access_key_id=settings.storage.aws_access_key_id,
        aws_secret_access_key=settings.storage.aws_secret_access_key) as client:
        await client.delete_object(Bucket=storage.private_audio_bucket_name, Key=r2_key)
    assert not await storage.object_exists(r2_key, private=True)
    await get_engine().dispose()
    print("fixture_album_zip_removed", flush=True)
asyncio.run(main())
"""
    process = await asyncio.create_subprocess_exec(
        "flyctl",
        "ssh",
        "console",
        "-a",
        "relay-api-staging",
        "--machine",
        maintenance_machine(),
        "-C",
        "timeout --signal=TERM --kill-after=5s 100s uv run --no-sync python -",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(script.encode()), 120)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise AssertionError("isolated album ZIP cleanup timed out") from None
    if process.returncode or b"fixture_album_zip_removed" not in stdout:
        raise AssertionError(
            f"isolated album ZIP cleanup failed: exit {process.returncode}"
        )
    smoke.passed("exact disposable album ZIP removed from private R2")


async def protected_album_zip(smoke: Smoke) -> None:
    album = checked(
        await smoke.http.post(
            f"{smoke.api}/albums/",
            headers=headers(smoke.owner),
            json={
                "title": f"protected album smoke {smoke.stamp}",
                "slug": f"protected-album-smoke-{smoke.stamp}",
                "publishing_defaults": {
                    "access": {
                        "visibility": "unlisted",
                        "listening": "public",
                        "downloads": "off",
                    }
                },
            },
        ),
        200,
        "create disposable album",
    ).json()
    track_id: int | None = None
    job_id: str | None = None
    archive_key: str | None = None
    path = f"{smoke.api}/albums/{album['artist_handle']}/{album['slug']}/download"
    try:
        body = audio(481)
        submitted = checked(
            await smoke.http.post(
                f"{smoke.api}/tracks/",
                headers=headers(smoke.owner),
                data={
                    "title": f"protected album original {smoke.stamp}",
                    "album_id": album["id"],
                    "tags": json.dumps(["integration-test", "protected-audio-smoke"]),
                },
                files={"file": ("album-source.wav", body, "audio/wav")},
            ),
            200,
            "album source submission",
        ).json()
        terminal = await smoke.wait_job(submitted["upload_id"], smoke.owner)
        track_id = int(terminal["track_id"])
        smoke.tracks[track_id] = smoke.owner
        track = checked(
            await smoke.http.get(
                f"{smoke.api}/tracks/{track_id}", headers=headers(smoke.owner)
            ),
            200,
            "album track",
        ).json()
        assert track["album"]["id"] == album["id"] and track["download_policy"] == "off"
        assert track["visibility"] == "unlisted"
        await smoke.inspect_spaces(track, body)
        for token in (None, smoke.reader):
            checked(
                await smoke.http.get(path, headers=headers(token) if token else {}),
                403,
                "album ZIP refusal before build",
            )
        pending = checked(
            await smoke.http.get(path, headers=headers(smoke.owner)),
            200,
            "owner album ZIP enqueue",
        ).json()
        job_id = pending["job_id"]
        async with smoke.http.stream(
            "GET", f"{smoke.api}/exports/{job_id}/progress"
        ) as response:
            checked(response, 200, "album ZIP progress")
            completed = False
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                event = json.loads(line[6:])
                assert event.get("status") != "failed", "album ZIP worker failed"
                if event.get("status") == "completed":
                    completed = True
                    break
            assert completed
        redirect = checked(
            await smoke.http.get(path, headers=headers(smoke.owner)),
            307,
            "owner album ZIP cached redirect",
        )
        key_match = re.search(
            rf"exports/albums/{re.escape(album['id'])}-[0-9a-f]{{16}}\.zip$",
            unquote(urlparse(redirect.headers["location"]).path),
        )
        assert key_match, "album redirect must name this disposable album's ZIP"
        archive_key = key_match.group()
        archive = checked(
            await smoke.http.get(redirect.headers["location"]),
            200,
            "private album ZIP bytes",
        )
        with zipfile.ZipFile(io.BytesIO(archive.content)) as zipped:
            assert len(zipped.namelist()) == 1
            original = zipped.read(zipped.namelist()[0])
            assert hashlib.sha256(original).digest() == hashlib.sha256(body).digest()
        for token in (None, smoke.reader):
            checked(
                await smoke.http.get(path, headers=headers(token) if token else {}),
                403,
                "album ZIP refusal after cache",
            )
        smoke.passed(
            "protected album ZIP original bytes match; anonymous and nonowner denied before and after cache",
            track_id=track_id,
            album_id=album["id"],
        )
    finally:
        try:
            if job_id and track_id:
                await cleanup_zip(smoke, album, track_id, job_id, path, archive_key)
        finally:
            checked(
                await smoke.http.delete(
                    f"{smoke.api}/albums/{album['id']}", headers=headers(smoke.owner)
                ),
                200,
                "delete disposable album",
            )
            smoke.passed("disposable album deleted")
