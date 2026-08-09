"""a track's audio key comes from its r2_url, not blindly from file_id.

regression: a portal PDS save reported "6 failed" on tracks whose audio was
sitting in the bucket the whole time. those rows came from jetstream ingest,
where `file_id` is `record["fileId"]` falling back to the rkey — so the save
asked storage for `audio/<rkey>.<ext>` while the bytes lived under the content
hash in `r2_url`. playback never noticed because it redirects to `r2_url`.
"""

import pytest

from backend.config import settings
from backend.storage.keys import AudioKey

_BUCKET = "https://audio-stg.plyr.fm"


@pytest.fixture(autouse=True)
def _bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings.storage, "r2_public_bucket_url", _BUCKET)


def test_ingested_row_resolves_to_the_key_in_its_url() -> None:
    """the rkey in file_id addresses nothing; the URL holds the real key."""
    key = AudioKey.for_track(
        file_id="3mskqx26ked22",
        file_type="webm",
        r2_url=f"{_BUCKET}/audio/53d0e394cf033b02.webm",
    )
    assert key.key == "audio/53d0e394cf033b02.webm"


def test_uploaded_row_without_a_url_falls_back_to_file_id() -> None:
    key = AudioKey.for_track(file_id="5e1db6607b79ec7f", file_type="wav", r2_url=None)
    assert key.key == "audio/5e1db6607b79ec7f.wav"


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example.com/audio/5e1db6607b79ec7f.wav",  # foreign origin
        "https://audio.plyr.fm/audio/5e1db6607b79ec7f.wav",  # another environment
        "http://audio-stg.plyr.fm/audio/5e1db6607b79ec7f.wav",  # scheme mismatch
    ],
)
def test_foreign_urls_never_become_our_storage_key(url: str) -> None:
    """a path lifted off someone else's origin would name OUR object while
    claiming to describe their bytes (#1778)."""
    assert AudioKey.from_url(url) is None
    assert (
        AudioKey.for_track(file_id="fallback", file_type="mp3", r2_url=url).key
        == "audio/fallback.mp3"
    )


@pytest.mark.parametrize(
    "url",
    [
        f"{_BUCKET}/images/abc.jpeg",  # not an audio object
        f"{_BUCKET}/audio/abc.txt",  # extension we don't store
        f"{_BUCKET}/audio/",  # no object
        "not a url",
    ],
)
def test_unusable_urls_return_none(url: str) -> None:
    assert AudioKey.from_url(url) is None
