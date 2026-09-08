import logging
from pathlib import Path

import pytest

import flow
from studio.state import Store


def test_evaluation_never_calls_publication_or_curation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STUDIO_STATE_DIR", str(tmp_path))
    monkeypatch.setattr(flow, "get_run_logger", lambda: logging.getLogger("test"))
    monkeypatch.setattr(flow, "seed", lambda _directory: ["reed"])
    monkeypatch.setattr(flow, "compose_piece", lambda *_args: {})
    monkeypatch.setattr(flow, "render_piece", lambda *_args: tmp_path / "draft.wav")
    monkeypatch.setattr(flow, "review_audio", lambda *_args: tmp_path / "revision.wav")
    monkeypatch.setattr(flow, "report", lambda *_args: None)

    def forbid_write(*_args: object) -> None:
        pytest.fail("An evaluation must not write to plyr.fm")

    monkeypatch.setattr(flow, "publish_piece", forbid_write)
    monkeypatch.setattr(flow, "curate_peer", forbid_write)
    assert flow.community.fn(evaluation=True).is_completed()
    store = Store(tmp_path)
    with store.connect() as db:
        session, status = db.execute("SELECT id,status FROM sessions").fetchone()
    assert session.endswith("-evaluation")
    assert status == "completed"
    assert store.study(session, "reed")["withheld"]


def test_arrangement_calibration_uses_evaluation_without_loading_musicians(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("STUDIO_STATE_DIR", str(tmp_path))
    monkeypatch.setattr(flow, "get_run_logger", lambda: logging.getLogger("test"))
    monkeypatch.setattr(flow, "report", lambda *_args: None)
    seen = []

    def calibrate(directory: Path, session: str, suite: str) -> dict:
        seen.append((directory, session, suite))
        return {"correct": 2, "total": 6}

    def forbid(*_args: object) -> None:
        pytest.fail("Calibration must not load musicians or publish")

    monkeypatch.setattr(flow, "calibrate_listener", calibrate)
    monkeypatch.setattr(flow, "seed", forbid)
    monkeypatch.setattr(flow, "publish_piece", forbid)
    assert flow.community.fn(
        evaluation=True, calibration=True, calibration_suite="arrangement"
    ).is_completed()
    assert seen[0][1].endswith("-evaluation")
    assert seen[0][2] == "arrangement"
    with pytest.raises(ValueError, match="requires calibration"):
        flow.community.fn(calibration_suite="arrangement")
