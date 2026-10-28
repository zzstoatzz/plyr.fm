"""Real mirror loss and format-alias cases for staging smoke fixtures."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

from _protected_audio_smoke import checked, headers, record_parts, with_nonce

if TYPE_CHECKING:
    from smoke_protected_audio import Smoke


async def missing_mirror(smoke: Smoke, track: dict[str, Any], original: bytes) -> None:
    track_id = track["id"]
    file_id = track["file_id"]
    extension = track["file_type"]
    if track_id not in smoke.tracks or not re.fullmatch(r"[0-9a-f]{16}", file_id):
        raise AssertionError("mirror removal requires this run's tracked content hash")
    if extension != "wav" or not track["title"].startswith(
        f"protected smoke {smoke.stamp} "
    ):
        raise AssertionError("mirror removal requires this run's generated WAV fixture")
    public = (await smoke.pds_record(track["atproto_record_uri"]))["value"]
    source_uri = public["audioSpace"]
    payload = {
        "track_id": track_id,
        "file_id": file_id,
        "extension": extension,
        "title": track["title"],
        "owner": record_parts(source_uri)["repo"],
        "source": source_uri,
    }
    script = f"""import asyncio, json
from sqlalchemy import or_, select
from backend.models import Track
from backend.models.track_revision import TrackRevision
from backend.storage import storage
from backend.utilities.database import db_session
payload = json.loads({json.dumps(payload)!r})
async def main():
    async with db_session() as db:
        track = await db.get(Track, payload["track_id"])
        assert track is not None and track.title == payload["title"]
        assert track.artist_did == payload["owner"]
        assert track.file_id == payload["file_id"] and track.file_type == payload["extension"]
        assert track.audio_storage == "r2_private" and not track.is_private
        assert track.protected_audio["record_uri"] == payload["source"]
        other = await db.scalar(select(Track.id).where(
            Track.id != track.id,
            or_(Track.file_id == payload["file_id"], Track.original_file_id == payload["file_id"]),
        ).limit(1))
        assert other is None, "another track references the fixture hash"
        revision = await db.scalar(select(TrackRevision.id).where(
            or_(TrackRevision.file_id == payload["file_id"], TrackRevision.original_file_id == payload["file_id"]),
        ).limit(1))
        assert revision is None, "a revision references the fixture hash"
    assert await storage.head_file(payload["file_id"], payload["extension"], private=True) is not None
    assert await storage.delete_gated(payload["file_id"], payload["extension"])
    assert await storage.head_file(payload["file_id"], payload["extension"], private=True) is None
    print("fixture_private_mirror_removed")
asyncio.run(main())
"""
    process = await asyncio.create_subprocess_exec(
        "fly",
        "ssh",
        "console",
        "-a",
        "relay-api-staging",
        "-g",
        "app",
        "-C",
        "uv run --no-sync python -",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _stderr = await asyncio.wait_for(
            process.communicate(script.encode()), 120
        )
    except TimeoutError:
        process.kill()
        await process.wait()
        raise AssertionError("staging fixture mirror-removal SSH timed out") from None
    if process.returncode != 0 or b"fixture_private_mirror_removed" not in stdout:
        raise AssertionError(
            f"staging fixture mirror removal failed: exit {process.returncode}"
        )
    response = checked(
        await smoke.http.get(f"{smoke.api}/audio/{file_id}", follow_redirects=True),
        200,
        "PDS playback after mirror loss",
    )
    assert (
        hashlib.sha256(response.content).digest() == hashlib.sha256(original).digest()
    )
    ranged = checked(
        await smoke.http.get(
            f"{smoke.api}/audio/{file_id}",
            headers={"Range": "bytes=100-199"},
            follow_redirects=True,
        ),
        206,
        "PDS seek after mirror loss",
    )
    assert ranged.content == original[100:200]
    recovered = checked(
        await smoke.http.get(
            f"{smoke.api}/audio/{file_id}/download",
            headers=headers(smoke.owner),
            follow_redirects=True,
        ),
        200,
        "owner source after mirror loss",
    )
    assert (
        hashlib.sha256(recovered.content).digest() == hashlib.sha256(original).digest()
    )
    await smoke.playback_and_downloads(track, smoke.owner)
    smoke.passed(
        "actual private R2 deletion leaves anonymous playback, seek, HEAD and owner recovery intact",
        track_id=track_id,
    )


async def aif_optimization(smoke: Smoke) -> None:
    frequency = 300 + int(smoke.stamp) % 1000
    with tempfile.TemporaryDirectory(prefix="plyr-protected-aif-") as directory:
        path = Path(directory) / "source.aif"
        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency={frequency}:duration=1",
            "-c:a",
            "pcm_s16be",
            str(path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await process.communicate()
        if process.returncode:
            raise AssertionError("could not generate synthetic AIFF fixture")
        source = with_nonce(await asyncio.to_thread(path.read_bytes))
    if not source.startswith(b"FORM"):
        raise AssertionError("generated fixture is not AIFF")
    track = await smoke.upload(
        smoke.owner, source, filename="smoke.aif", content_type="audio/aiff"
    )
    await smoke.inspect_spaces(track, source)
    smoke.passed(
        "raw .aif source published on PDS before deferred optimization",
        track_id=track["id"],
        initial_file_type=track["file_type"],
    )
    for _ in range(120):
        current = checked(
            await smoke.http.get(
                f"{smoke.api}/tracks/{track['id']}", headers=headers(smoke.owner)
            ),
            200,
            "AIFF optimization progress",
        ).json()
        if current["file_type"] == "mp3":
            assert current["original_file_type"] == "aif"
            await smoke.inspect_spaces(current, source)
            await smoke.playback_and_downloads(current, smoke.owner)
            original = checked(
                await smoke.http.get(
                    f"{smoke.api}/audio/{current['file_id']}/download",
                    headers=headers(smoke.owner),
                    follow_redirects=True,
                ),
                200,
                "optimized .aif original recovery",
            )
            assert (
                hashlib.sha256(original.content).digest()
                == hashlib.sha256(source).digest()
            )
            smoke.passed(
                "deferred MP3 preserves .aif source bytes and protected PDS storage",
                track_id=track["id"],
            )
            return
        await asyncio.sleep(1)
    raise AssertionError("synthetic .aif did not optimize to MP3 within 120 seconds")
