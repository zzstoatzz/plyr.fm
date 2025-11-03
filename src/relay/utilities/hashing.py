"""streaming hash calculation utilities."""

import hashlib
from typing import BinaryIO

# 8MB chunks balances memory usage and performance
CHUNK_SIZE = 8 * 1024 * 1024


def hash_file_chunked(file_obj: BinaryIO, algorithm: str = "sha256") -> str:
    """compute hash by reading file in chunks.

    this prevents loading entire file into memory, enabling constant
    memory usage regardless of file size.

    args:
        file_obj: file-like object to hash
        algorithm: hash algorithm (default: sha256)

    returns:
        hexadecimal digest string

    example:
        >>> with open("large_file.wav", "rb") as f:
        >>>     file_hash = hash_file_chunked(f)
        >>>     print(file_hash[:16])  # first 16 chars for file_id

    note:
        file pointer is reset to beginning after hashing so subsequent
        operations (like upload) can read from start
    """
    hasher = hashlib.new(algorithm)

    # ensure we start from beginning
    file_obj.seek(0)

    # read and hash in chunks
    while chunk := file_obj.read(CHUNK_SIZE):
        hasher.update(chunk)

    # reset pointer for next operation
    file_obj.seek(0)

    return hasher.hexdigest()
