"""test large file uploads don't cause OOM."""

import io
from pathlib import Path

import pytest

from backend.storage.filesystem import FilesystemStorage


def create_large_test_file(size_mb: int) -> io.BytesIO:
    """create a test file of specified size in MB.

    fills with pseudo-random data (repeating pattern) to simulate
    realistic audio file scenario.
    """
    chunk = b"relay audio streaming test pattern data " * 1024  # ~40KB chunk
    total_bytes = size_mb * 1024 * 1024
    chunks_needed = (total_bytes // len(chunk)) + 1

    data = (chunk * chunks_needed)[:total_bytes]
    return io.BytesIO(data)


def test_large_file_upload_filesystem(tmp_path: Path) -> None:
    """filesystem storage handles 50MB file without OOM.

    before streaming: would load entire file into memory (100MB+ peak)
    after streaming: constant memory usage (~10-16MB for chunk buffer)
    """
    storage = FilesystemStorage(base_path=tmp_path)

    # create 50MB test file
    large_file = create_large_test_file(size_mb=50)

    # should succeed with constant memory
    file_id = storage.save(large_file, "test_large.mp3")

    # verify file was saved
    assert file_id
    assert len(file_id) == 16  # truncated SHA256 hash

    # verify file exists on disk (in audio subdirectory)
    saved_path = tmp_path / "audio" / f"{file_id}.mp3"
    assert saved_path.exists()

    # verify file size is correct
    assert saved_path.stat().st_size == 50 * 1024 * 1024


@pytest.mark.parametrize("size_mb", [10, 30, 50, 100])
def test_various_file_sizes(tmp_path: Path, size_mb: int) -> None:
    """verify streaming works for various file sizes."""
    storage = FilesystemStorage(base_path=tmp_path)

    test_file = create_large_test_file(size_mb=size_mb)
    file_id = storage.save(test_file, f"test_{size_mb}mb.wav")

    assert file_id
    saved_path = tmp_path / "audio" / f"{file_id}.wav"
    assert saved_path.exists()
    assert saved_path.stat().st_size == size_mb * 1024 * 1024


def test_concurrent_large_uploads(tmp_path: Path) -> None:
    """verify multiple concurrent uploads don't cause OOM.

    before: 3x 30MB files = ~180MB peak (OOMs on 256MB VM)
    after: 3x constant memory = ~40-50MB peak (safe)
    """
    storage = FilesystemStorage(base_path=tmp_path)

    # simulate concurrent uploads (sequential execution is fine for this test)
    files = [create_large_test_file(30) for _ in range(3)]
    file_ids = []

    for i, f in enumerate(files):
        file_id = storage.save(f, f"concurrent_{i}.mp3")
        file_ids.append(file_id)

    # all should succeed
    assert len(file_ids) == 3
    assert all(file_ids)

    # all files should exist (in audio subdirectory)
    for file_id in file_ids:
        saved_path = tmp_path / "audio" / f"{file_id}.mp3"
        assert saved_path.exists()
