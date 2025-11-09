#!/usr/bin/env python3
"""test image upload and retrieval with updated R2Storage."""

from io import BytesIO

from backend.storage.r2 import R2Storage


def main():
    """test saving, retrieving, and deleting an image."""
    storage = R2Storage()

    # create a simple test image (1x1 pixel PNG)
    test_png = BytesIO(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    print("testing image save and retrieval:")
    file_id = storage.save(test_png, "test.png")
    print(f"  saved image with id: {file_id}")

    url = storage.get_url(file_id)
    print(f"  retrieved url: {url}")

    # clean up
    if url:
        deleted = storage.delete(file_id)
        print(f"  deleted: {deleted}")


if __name__ == "__main__":
    main()
