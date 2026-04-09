"""integration tests for track upload/delete using real API token.

these tests require:
- PLYRFM_API_TOKEN or PLYR_TOKEN env var
- running backend (local or remote)
- set PLYR_API_URL for non-local testing (default: http://localhost:8001)

run with: uv run pytest tests/test_integration_upload.py -m integration -v
"""

import json
import os
import struct
import subprocess
import tempfile
from collections.abc import Generator
from pathlib import Path

import httpx
import pytest

API_URL = os.getenv("PLYR_API_URL", "http://localhost:8001")
TOKEN = os.getenv("PLYR_TOKEN") or os.getenv("PLYRFM_API_TOKEN")

# formats exercised by the integration suite — each variant runs the full
# upload → process → verify → delete flow. webm and ogg are the formats
# produced by browser MediaRecorder on Chrome/Firefox and are routed
# through the transcoder service on upload, so parameterizing covers the
# /record page end-to-end.
AUDIO_FORMATS: dict[str, str] = {
    "wav": "audio/wav",
    "webm": "audio/webm",
    "ogg": "audio/ogg",
}


def generate_wav_file(duration_seconds: float = 1.0, sample_rate: int = 44100) -> bytes:
    """generate a minimal valid WAV file with silence."""
    num_channels = 1
    bits_per_sample = 16
    num_samples = int(sample_rate * duration_seconds)
    data_size = num_samples * num_channels * (bits_per_sample // 8)

    # WAV header
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,  # file size - 8
        b"WAVE",
        b"fmt ",
        16,  # fmt chunk size
        1,  # audio format (PCM)
        num_channels,
        sample_rate,
        sample_rate * num_channels * (bits_per_sample // 8),  # byte rate
        num_channels * (bits_per_sample // 8),  # block align
        bits_per_sample,
        b"data",
        data_size,
    )

    # silence (zeros)
    audio_data = b"\x00" * data_size

    return header + audio_data


def _ffmpeg_generate_tone(target_fmt: str, duration: float = 2.0) -> bytes:
    """use ffmpeg's lavfi sine generator to produce a short tone in the
    target container format.

    webm and ogg both use opus via libopus and can stream to pipe:1.
    generating a real sine wave (not silence from a pre-built wav) gives
    mutagen enough structure to parse duration, which matches what a real
    browser MediaRecorder produces much more closely than a minimal
    silent file would. mp4 (m4a) can't write to a pipe because the
    container needs seekable output, so it's not supported here.
    """
    codec_by_fmt = {
        "webm": (["-c:a", "libopus"], "webm"),
        "ogg": (["-c:a", "libopus"], "ogg"),
    }
    if target_fmt not in codec_by_fmt:
        raise ValueError(f"no ffmpeg pipeline for format: {target_fmt}")
    codec_args, fmt_flag = codec_by_fmt[target_fmt]
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"sine=frequency=440:duration={duration}",
                *codec_args,
                "-f",
                fmt_flag,
                "pipe:1",
            ],
            capture_output=True,
            check=False,
        )
    except FileNotFoundError:
        pytest.skip(
            f"ffmpeg not installed — required to generate test audio for {target_fmt}"
        )
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg generation of {target_fmt} failed: "
            f"{result.stderr.decode(errors='replace')[:500]}"
        )
    return result.stdout


def _generate_audio(fmt: str) -> bytes:
    """generate a short test audio file in the requested format."""
    if fmt == "wav":
        return generate_wav_file(duration_seconds=1.0)
    return _ffmpeg_generate_tone(fmt)


@pytest.fixture(params=list(AUDIO_FORMATS.keys()))
def test_audio_file(
    request: pytest.FixtureRequest,
) -> Generator[tuple[Path, str, str], None, None]:
    """create a temporary test audio file in each supported format."""
    fmt = request.param
    mime = AUDIO_FORMATS[fmt]
    audio_bytes = _generate_audio(fmt)

    with tempfile.NamedTemporaryFile(suffix=f".{fmt}", delete=False) as f:
        f.write(audio_bytes)
        path = Path(f.name)

    yield path, fmt, mime

    # cleanup
    path.unlink(missing_ok=True)


@pytest.mark.integration
async def test_upload_and_delete_track(test_audio_file: tuple[Path, str, str]):
    """integration test: upload a track, wait for processing, then delete it.

    parameterized across wav / webm / ogg — webm and ogg exercise the
    transcoder path that the /record page depends on.
    """
    audio_path, fmt, mime = test_audio_file
    if not TOKEN:
        pytest.skip("PLYR_TOKEN or PLYRFM_API_TOKEN not set")

    async with httpx.AsyncClient(timeout=120.0) as client:
        # 1. verify auth works
        auth_response = await client.get(
            f"{API_URL}/auth/me",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        if auth_response.status_code == 401:
            pytest.skip("token is invalid or expired")
        assert auth_response.status_code == 200, f"auth failed: {auth_response.text}"
        user = auth_response.json()
        print(f"authenticated as: {user['handle']}")

        # 2. upload track
        with open(audio_path, "rb") as f:
            files = {"file": (f"test_integration.{fmt}", f, mime)}
            data = {"title": f"Integration Test Track [{fmt}] (DELETE ME)"}

            upload_response = await client.post(
                f"{API_URL}/tracks/",
                headers={"Authorization": f"Bearer {TOKEN}"},
                files=files,
                data=data,
            )

        if upload_response.status_code == 403:
            detail = upload_response.json().get("detail", "")
            if "artist_profile_required" in detail:
                pytest.skip("user needs artist profile setup")
            if "scope_upgrade_required" in detail:
                pytest.skip("token needs re-authorization with new scopes")

        assert upload_response.status_code == 200, (
            f"upload failed: {upload_response.text}"
        )

        upload_data = upload_response.json()
        upload_id = upload_data["upload_id"]
        print(f"upload started: {upload_id}")

        # 3. poll for completion via SSE
        track_id = None
        async with client.stream(
            "GET",
            f"{API_URL}/tracks/uploads/{upload_id}/progress",
            headers={"Authorization": f"Bearer {TOKEN}"},
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    status = data.get("status")
                    print(f"  status: {status} - {data.get('message', '')}")

                    if status == "completed":
                        track_id = data.get("track_id")
                        print(f"upload complete! track_id: {track_id}")
                        break
                    elif status == "failed":
                        error = data.get("error", "unknown error")
                        pytest.fail(f"upload failed: {error}")

        assert track_id is not None, "upload completed but no track_id returned"

        # 4. verify track exists
        track_response = await client.get(f"{API_URL}/tracks/{track_id}")
        assert track_response.status_code == 200, (
            f"track not found: {track_response.text}"
        )
        track = track_response.json()
        print(f"track created: {track['title']} by {track['artist']['handle']}")

        # 5. delete track
        delete_response = await client.delete(
            f"{API_URL}/tracks/{track_id}",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        assert delete_response.status_code == 200, (
            f"delete failed: {delete_response.text}"
        )
        print(f"track {track_id} deleted successfully")

        # 6. verify track is gone
        verify_response = await client.get(f"{API_URL}/tracks/{track_id}")
        assert verify_response.status_code == 404, "track should be deleted"
        print("verified track no longer exists")
