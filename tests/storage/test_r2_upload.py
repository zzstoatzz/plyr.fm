"""test R2 upload functionality."""

import shutil
from pathlib import Path

import logfire
import pytest

from backend.storage import storage
from backend.storage.r2 import R2Storage


@pytest.mark.skip(
    reason="requires R2 credentials and data directory - manual test only"
)
async def test_r2_upload():
    """test uploading a file to R2 and retrieving its URL."""
    # configure logfire for test to suppress warnings
    logfire.configure(send_to_logfire=False)
    # copy existing test file
    source = Path("data/audio/f6197e825152d2b5.m4a")
    test_dir = Path("tests/fixtures")
    test_dir.mkdir(parents=True, exist_ok=True)
    test_file = test_dir / "test_audio.m4a"
    shutil.copy(source, test_file)

    print(f"test file created: {test_file}")
    print(f"file size: {test_file.stat().st_size} bytes")

    # verify we're using R2 storage
    assert isinstance(storage, R2Storage), f"expected R2Storage, got {type(storage)}"
    print("✓ using R2 storage")

    # upload file
    with open(test_file, "rb") as f:
        file_id = await storage.save(f, "test_audio.m4a")

    print(f"✓ uploaded file with id: {file_id}")

    # get URL
    url = await storage.get_url(file_id)
    print(f"✓ got public URL: {url}")

    # verify URL format
    assert url is not None
    assert url.startswith("https://")
    assert "r2.dev" in url
    assert file_id in url

    print("\n✓ all tests passed!")
    print(f"\nfile is accessible at: {url}")

    # cleanup
    test_file.unlink()
    test_dir.rmdir()


if __name__ == "__main__":
    test_r2_upload()
