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
import tempfile
from collections.abc import Generator
from pathlib import Path

import httpx
import pytest

API_URL = os.getenv("PLYR_API_URL", "http://localhost:8001")
TOKEN = os.getenv("PLYR_TOKEN") or os.getenv("PLYRFM_API_TOKEN")


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


@pytest.fixture
def test_audio_file() -> Generator[Path, None, None]:
    """create a temporary test audio file."""
    wav_data = generate_wav_file(duration_seconds=1.0)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(wav_data)
        path = Path(f.name)

    yield path

    # cleanup
    path.unlink(missing_ok=True)


@pytest.mark.integration
async def test_upload_and_delete_track(test_audio_file: Path):
    """integration test: upload a track, wait for processing, then delete it."""
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
        with open(test_audio_file, "rb") as f:
            files = {"file": ("test_integration.wav", f, "audio/wav")}
            data = {"title": "Integration Test Track (DELETE ME)"}

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
