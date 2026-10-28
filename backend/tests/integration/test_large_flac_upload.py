"""The advertised size must survive transfer, conversion, and playback."""

import asyncio
import hashlib
import json
import sys
from pathlib import Path

import httpx
import pytest
from plyrfm import AsyncPlyrClient

from .test_lossless_uploads import _wait_for_upload


@pytest.mark.integration
@pytest.mark.timeout(1200)
async def test_large_flac_upload_and_playback(
    user1_client: AsyncPlyrClient, tmp_path: Path
) -> None:
    root = Path(__file__).resolve().parents[3]
    source = tmp_path / "boundary.flac"
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        str(root / "scripts/transcoder/test-upload-boundary.py"),
        "--generate",
        str(source),
    )
    assert await process.wait() == 0
    api = user1_client._url("")
    headers = user1_client._auth_headers
    track_id: int | None = None
    async with httpx.AsyncClient(timeout=600, headers=headers) as http:
        response = await http.post(
            f"{api}/tracks/uploads",
            json={"filename": source.name, "size_bytes": source.stat().st_size},
        )
        response.raise_for_status()
        session = response.json()
        upload_id = session["upload_id"]
        with source.open("rb") as audio:
            for part in range(1, session["part_count"] + 1):
                response = await http.put(
                    f"{api}/tracks/uploads/{upload_id}/parts/{part}",
                    content=audio.read(session["part_size_bytes"]),
                )
                response.raise_for_status()
        response = await http.post(
            f"{api}/tracks/uploads/{upload_id}/finish",
            data={
                "title": "large FLAC capacity regression",
                "accept_plyr_storage": "true",
                "tags": json.dumps(["integration-test"]),
                "publishing": json.dumps(
                    {
                        "access": {
                            "visibility": "unlisted",
                            "listening": "public",
                            "downloads": "off",
                        },
                        "attach_rights": False,
                    }
                ),
            },
        )
        response.raise_for_status()
        try:
            token = headers["Authorization"].removeprefix("Bearer ")
            track_id = await _wait_for_upload(http, api, token, upload_id)
            response = await http.get(f"{api}/tracks/{track_id}")
            response.raise_for_status()
            track = response.json()
            expected_codec = "flac" if track.get("audio_space") else "mp3"
            assert track["file_type"] == expected_codec
            assert track["audio_storage"] == "r2_private"
            assert track["pds_blob_cid"] is None
            assert track["download_policy"] == "off"
            assert track["visibility"] == "unlisted"
            response = await http.get(f"{api}/audio/{track['file_id']}?cors=1")
            response.raise_for_status()
            assert not response.is_redirect
            if track.get("audio_space"):
                source_bytes = await asyncio.to_thread(source.read_bytes)
                assert (
                    hashlib.sha256(response.content).digest()
                    == hashlib.sha256(source_bytes).digest()
                )
            output = tmp_path / f"playback.{expected_codec}"
            output.write_bytes(response.content)
            process = await asyncio.create_subprocess_exec(
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "json",
                str(output),
                stdout=asyncio.subprocess.PIPE,
            )
            encoded_probe, _ = await process.communicate()
            assert process.returncode == 0
            assert (
                json.loads(encoded_probe)["streams"][0]["codec_name"] == expected_codec
            )
            process = await asyncio.create_subprocess_exec(
                "ffmpeg", "-v", "error", "-i", str(output), "-f", "null", "-"
            )
            assert await process.wait() == 0
        finally:
            if track_id is not None:
                await user1_client.tracks.delete(track_id)
