from datetime import UTC, datetime
from pathlib import Path

import pytest

import flow
from compose import Composition
from studio import render_repair
from studio.render_process import RenderError
from studio.state import Store


@pytest.mark.parametrize("fixed_works", [True, False])
def test_runtime_repair_is_charged_bounded_and_reused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fixed_works: bool
) -> None:
    store = Store(tmp_path)
    session = store.reserve(datetime.now(UTC))
    original = 'TITLE="one"\nIDEA="two"\nrng.default_rng(1)'
    corrected = 'TITLE="one"\nIDEA="two"\nnp.random.default_rng(1)'
    store.save_study(
        session,
        "reed",
        Composition(title="one", idea="two", python=original).model_dump(),
    )
    calls = []

    def render(code: str, output: Path) -> dict:
        if code == original or not fixed_works:
            raise RenderError(
                "exited 1", "Traceback: AttributeError: Generator has no default_rng"
            )
        output.mkdir(parents=True, exist_ok=True)
        (output / "track.wav").write_bytes(b"rendered corrected source")
        return {"duration": 10}

    def request(prompt: str, ledger: Store, key: str) -> str:
        assert original in prompt and "AttributeError" in prompt
        ledger.call(key)
        ledger.charge(key, 0.002)
        calls.append(prompt)
        return corrected

    monkeypatch.setattr(render_repair, "render", render)
    monkeypatch.setattr(flow, "render", render, raising=False)
    monkeypatch.setattr(render_repair, "request_music", request)
    for _ in range(2):
        if fixed_works:
            assert (
                flow.render_piece.fn(tmp_path, session, "reed").read_bytes()
                == b"rendered corrected source"
            )
        else:
            with pytest.raises(RenderError):
                flow.render_piece.fn(tmp_path, session, "reed")
    assert len(calls) == 1
    assert store.usage(datetime.now(UTC))["day"]["calls"] == 1
    assert store.usage(datetime.now(UTC))["day"]["estimated_cost"] == 0.002
    saved = store.study(session, "reed")
    assert saved["render_repairs"]["draft"]["original"] == original
    assert saved["render_repairs"]["draft"]["corrected"] == corrected
    if fixed_works:
        assert saved["python"] == corrected
        assert saved["title"] == "one"
