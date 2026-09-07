from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import pytest

from studio.platform import Platform
from studio.state import Store


def saved(tmp_path: Path) -> tuple[Store, Path]:
    store = Store(tmp_path)
    store.save_study(
        "2026-09-07-0", "moss", {"title": "one", "idea": "a piece", "rendered": True}
    )
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"mock audio")
    return store, audio


def test_upload_is_unlisted_labeled_and_recovery_does_not_post_twice(
    tmp_path: Path,
) -> None:
    store, audio = saved(tmp_path)
    posts = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            body = request.read()
            assert (
                b"unlisted" in body
                and b"ai-generated" in body
                and b"agent-musicians" in body
            )
            posts.append(request.url.path)
            return httpx.Response(200, json={"upload_id": "u1"})
        if request.url.path.endswith("progress"):
            return httpx.Response(
                200, text='data: {"status":"completed","track_id":123}\n\n'
            )
        return httpx.Response(
            200,
            json={"id": 123, "visibility": "unlisted", "self_labels": ["ai-generated"]},
        )

    with Platform("test", transport=httpx.MockTransport(handle)) as api:
        assert api.publish(store, "2026-09-07-0", "moss", audio) == 123
        assert api.publish(Store(tmp_path), "2026-09-07-0", "moss", audio) == 123
    assert posts == ["/tracks/"]


def test_unknown_upload_outcome_retains_daily_reservation(tmp_path: Path) -> None:
    store, audio = saved(tmp_path)
    calls = []

    def fail(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        raise httpx.ReadTimeout("unknown upload outcome")

    with Platform("test", transport=httpx.MockTransport(fail)) as api:
        with pytest.raises(httpx.ReadTimeout):
            api.publish(store, "2026-09-07-0", "moss", audio)
        assert api.publish(Store(tmp_path), "2026-09-07-0", "moss", audio) is None
    assert len(calls) == 1


def test_daily_claim_is_atomic_across_connections(tmp_path: Path) -> None:
    store, _ = saved(tmp_path)
    with ThreadPoolExecutor(max_workers=4) as pool:
        claims = list(
            pool.map(
                lambda _: Store(tmp_path).claim_upload("2026-09-07-0", "moss"), range(4)
            )
        )
    assert claims.count(True) == 1
    assert store.released_today("moss", "2026-09-07")


def test_playlist_reuses_existing_owned_list() -> None:
    calls = []

    def handle(request: httpx.Request) -> httpx.Response:
        calls.append(request.method)
        return httpx.Response(
            200, json=[{"id": "playlist", "name": "Moss — listening"}]
        )

    with Platform("test", transport=httpx.MockTransport(handle)) as api:
        assert api.playlist("Moss") == "playlist"
    assert calls == ["GET"]
