"""test R2 upload functionality."""

import shutil
from pathlib import Path

from backend.storage import storage
from backend.storage.r2 import R2Storage


def test_r2_upload():
    """test uploading a file to R2 and retrieving its URL."""
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
        file_id = storage.save(f, "test_audio.m4a")

    print(f"✓ uploaded file with id: {file_id}")

    # get URL
    url = storage.get_url(file_id)
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
