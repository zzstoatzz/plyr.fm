"""tests for chunked hash calculation."""

import hashlib
import io

from relay.utilities.hashing import hash_file_chunked


def test_hash_file_chunked_correctness() -> None:
    """chunked hashing must produce same result as standard approach."""
    # create test data larger than chunk size to test chunking
    test_data = b"relay audio streaming test data " * 500000  # ~16MB

    # standard approach (what we used before)
    expected_hash = hashlib.sha256(test_data).hexdigest()

    # chunked approach (new implementation)
    file_obj = io.BytesIO(test_data)
    actual_hash = hash_file_chunked(file_obj)

    assert actual_hash == expected_hash, (
        f"chunked hash doesn't match standard hash\n"
        f"expected: {expected_hash}\n"
        f"actual:   {actual_hash}"
    )


def test_hash_file_chunked_resets_pointer() -> None:
    """file pointer must be reset after hashing for subsequent operations."""
    test_data = b"test data for pointer reset verification"

    file_obj = io.BytesIO(test_data)

    # hash the file
    hash_file_chunked(file_obj)

    # pointer should be at start
    assert file_obj.tell() == 0, "file pointer not reset after hashing"

    # should be able to read full content
    content = file_obj.read()
    assert content == test_data, "can't read full content after hashing"


def test_hash_file_chunked_empty_file() -> None:
    """hashing empty file should work without error."""
    file_obj = io.BytesIO(b"")

    file_hash = hash_file_chunked(file_obj)

    # empty data has known SHA256 hash
    expected = hashlib.sha256(b"").hexdigest()
    assert file_hash == expected
