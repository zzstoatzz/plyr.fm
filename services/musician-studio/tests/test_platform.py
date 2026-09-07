from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import pytest

from studio.listening import ListeningReview, digest, inspiration_digest, record_review
from studio.platform import Platform
from studio.state import Store


def saved(tmp_path: Path) -> tuple[Store, Path]:
    store = Store(tmp_path)
    store.save_study(
        "2026-09-07-0", "moss", {"title": "one", "idea": "a piece", "rendered": True}
    )
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"mock audio")
    inspirations = [
        {"artist": "test", "work": "test", "reason": "test", "experiment": "test"}
    ]
    store.save_study(
        "2026-09-07-0",
        "moss",
        {"draft_audio_sha256": "a" * 64, "review_inspirations": inspirations},
    )
    for listener, sha in [
        ("moss", "a" * 64),
        ("moss", digest(audio)),
        ("reed", digest(audio)),
    ]:
        record_review(
            store,
            "2026-09-07-0",
            "moss",
            ListeningReview(
                listener=listener,
                author="moss",
                audio_sha256=sha,
                model="test-audio",
                audio_tokens=250,
                inspirations_sha256=inspiration_digest(inspirations),
                observations="An audible sustained chord.",
                changes="Reduce the bass level.",
                ready=True,
            ),
        )
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


def test_missing_audio_evidence_blocks_upload_before_network(tmp_path: Path) -> None:
    store, audio = saved(tmp_path)
    with store.connect() as db:
        db.execute("DELETE FROM listening_reviews")

    def forbidden(request: httpx.Request) -> httpx.Response:
        pytest.fail("No HTTP request is allowed without listening evidence")

    with (
        Platform("test", transport=httpx.MockTransport(forbidden)) as api,
        pytest.raises(ValueError, match="audio self-review"),
    ):
        api.publish(store, "2026-09-07-0", "moss", audio)
    assert not store.released_today("moss", "2026-09-07")


@pytest.mark.parametrize(
    "change", ["audio", "inspirations", "peer", "approval", "revision"]
)
def test_stale_or_incomplete_evidence_cannot_publish(
    tmp_path: Path, change: str
) -> None:
    store, audio = saved(tmp_path)
    if change == "audio":
        audio.write_bytes(b"different recording")
    elif change == "inspirations":
        store.save_study(
            "2026-09-07-0", "moss", {"review_inspirations": [{"artist": "different"}]}
        )
    elif change == "revision":
        store.save_study("2026-09-07-0", "moss", {"draft_audio_sha256": digest(audio)})
    else:
        with store.connect() as db:
            if change == "peer":
                db.execute(
                    "DELETE FROM listening_reviews WHERE json_extract(body, '$.listener')='reed'"
                )
            else:
                db.execute(
                    "UPDATE listening_reviews SET body=json_set(body, '$.ready', json('false'))"
                )
    with (
        Platform(
            "test",
            transport=httpx.MockTransport(
                lambda _: pytest.fail("Unexpected network request")
            ),
        ) as api,
        pytest.raises(ValueError),
    ):
        api.publish(store, "2026-09-07-0", "moss", audio)
