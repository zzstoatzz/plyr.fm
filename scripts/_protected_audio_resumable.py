"""Exercise the browser's multipart transport against protected staging storage."""

from __future__ import annotations

import asyncio
import io
import json
import time
import wave
from typing import TYPE_CHECKING

from _protected_audio_smoke import checked, headers, maintenance_machine, with_nonce

if TYPE_CHECKING:
    from smoke_protected_audio import Smoke


def multipart_audio() -> bytes:
    stream = io.BytesIO()
    with wave.open(stream, "wb") as output:
        output.setparams((2, 2, 192000, 0, "NONE", "not compressed"))
        sample = (time.time_ns() % 10000).to_bytes(2, "little", signed=True)
        output.writeframes(sample * (192000 * 2 * 15))
    return with_nonce(stream.getvalue())


async def cleanup_transfer(
    smoke: Smoke, upload_id: str, filename: str, owner: str
) -> None:
    payload = json.dumps({"id": upload_id, "filename": filename, "owner": owner})
    script = f"""import asyncio, json
from backend._internal.jobs import job_service
from backend.models.job import JobStatus, JobType
from backend.storage import storage
from backend.storage.keys import StagedUploadKey
payload = json.loads({payload!r})
async def main():
    job = await job_service.get_job(payload["id"])
    assert job is not None and job.owner_did == payload["owner"]
    assert job.type == JobType.UPLOAD.value
    transfer = (job.result or {{}}).get("transfer")
    if job.phase == "transfer" and job.status == JobStatus.PENDING.value:
        assert transfer and transfer["filename"] == payload["filename"]
        staged = StagedUploadKey(upload_id=job.id, extension=transfer["extension"])
        await storage.abort_staged_upload(staged, transfer["multipart_id"])
        await storage.delete_staged(staged)
        await job_service.update_progress(job.id, JobStatus.FAILED,
            "smoke fixture transfer removed", error="smoke fixture cleanup")
    print("fixture_transfer_cleaned")
asyncio.run(main())
"""
    process = await asyncio.create_subprocess_exec(
        "fly",
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
        raise AssertionError("resumable fixture cleanup SSH timed out") from None
    if process.returncode or b"fixture_transfer_cleaned" not in stdout:
        raise AssertionError("resumable fixture transfer cleanup failed")


async def resumable_upload(smoke: Smoke) -> None:
    body = await asyncio.to_thread(multipart_audio)
    filename = f"protected-resumable-{smoke.stamp}.wav"
    owner = checked(
        await smoke.http.get(f"{smoke.api}/auth/me", headers=headers(smoke.owner)),
        200,
        "resumable owner identity",
    ).json()["did"]
    state = checked(
        await smoke.http.post(
            f"{smoke.api}/tracks/uploads",
            headers=headers(smoke.owner),
            json={"filename": filename, "size_bytes": len(body)},
        ),
        200,
        "resumable session start",
    ).json()
    upload_id = state["upload_id"]
    metadata = {
        "title": f"protected smoke {smoke.stamp} resumable",
        "publishing": json.dumps(
            {
                "access": {
                    "listening": "public",
                    "downloads": "off",
                    "visibility": "unlisted",
                }
            }
        ),
        "tags": json.dumps(["integration-test", "protected-audio-smoke"]),
    }
    try:
        assert state["part_count"] >= 2 and not state["received_parts"]
        part_size = state["part_size_bytes"]
        checked(
            await smoke.http.put(
                f"{smoke.api}/tracks/uploads/{upload_id}/parts/1",
                headers={
                    **headers(smoke.owner),
                    "Content-Type": "application/octet-stream",
                },
                content=body[:part_size],
            ),
            200,
            "resumable first part",
        )
        checked(
            await smoke.http.post(
                f"{smoke.api}/tracks/uploads/{upload_id}/finish",
                headers=headers(smoke.owner),
                files={key: (None, value) for key, value in metadata.items()},
            ),
            409,
            "incomplete protected upload remains resumable",
        )
        resumed = checked(
            await smoke.http.get(
                f"{smoke.api}/tracks/uploads/{upload_id}",
                headers=headers(smoke.owner),
            ),
            200,
            "resumable session recovery",
        ).json()
        assert resumed["received_parts"] == [1]
        for part in range(2, resumed["part_count"] + 1):
            checked(
                await smoke.http.put(
                    f"{smoke.api}/tracks/uploads/{upload_id}/parts/{part}",
                    headers={
                        **headers(smoke.owner),
                        "Content-Type": "application/octet-stream",
                    },
                    content=body[(part - 1) * part_size : part * part_size],
                ),
                200,
                "resumed audio part",
            )
        finished = checked(
            await smoke.http.post(
                f"{smoke.api}/tracks/uploads/{upload_id}/finish",
                headers=headers(smoke.owner),
                files={key: (None, value) for key, value in metadata.items()},
            ),
            200,
            "protected resumable finish",
        )
        terminal = await smoke.wait_job(finished.json()["upload_id"], smoke.owner)
        track_id = int(terminal["track_id"])
        smoke.tracks[track_id] = smoke.owner
        track = checked(
            await smoke.http.get(
                f"{smoke.api}/tracks/{track_id}",
                headers=headers(smoke.owner),
            ),
            200,
            "resumable protected track",
        ).json()
        assert track["audio_storage"] == "r2_private"
        assert track["pds_blob_cid"] is None
        assert track["visibility"] == "unlisted"
        await smoke.inspect_spaces(track, body)
        await smoke.playback_and_downloads(track, smoke.owner)
        smoke.passed(
            "multipart upload resumes from R2 staging into owned protected PDS audio",
            track_id=track_id,
            parts=state["part_count"],
            bytes=len(body),
        )
    finally:
        await cleanup_transfer(smoke, upload_id, filename, owner)
