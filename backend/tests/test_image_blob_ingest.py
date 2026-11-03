"""imageBlob: cover art on the artist's own PDS becomes the trusted image URL."""

from backend._internal.tasks.origin_trust import image_blob_url as _image_blob_url
from backend.models import Artist


def _artist(pds_url: str | None = "https://pds.example.com") -> Artist:
    return Artist(
        did="did:plc:art", handle="art.test", display_name="Art", pds_url=pds_url
    )


def _record(cid: object = "bafkreiimage") -> dict:
    return {
        "title": "t",
        "imageUrl": "https://elsewhere.example.com/x.jpg",
        "imageBlob": {
            "$type": "blob",
            "ref": {"$link": cid},
            "mimeType": "image/png",
            "size": 10,
        },
    }


def test_blob_url_derived_from_artist_pds() -> None:
    assert _image_blob_url(_record(), _artist()) == (
        "https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=did:plc:art&cid=bafkreiimage"
    )


def test_no_blob_means_no_url() -> None:
    assert (
        _image_blob_url({"imageUrl": "https://x.example.com/a.jpg"}, _artist()) is None
    )


def test_malformed_blob_ref_is_ignored() -> None:
    assert _image_blob_url(_record(cid=None), _artist()) is None
    assert _image_blob_url({"imageBlob": "bafy"}, _artist()) is None


def test_unknown_or_unsafe_pds_is_ignored() -> None:
    assert _image_blob_url(_record(), _artist(pds_url=None)) is None
    assert _image_blob_url(_record(), _artist(pds_url="http://127.0.0.1:2583")) is None
    assert _image_blob_url(_record(), None) is None
