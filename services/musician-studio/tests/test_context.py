import json
from pathlib import Path

from studio.context import choose_peer, history_context, musical_identity
from studio.identity import Musician
from studio.state import Store

ROOT = Path(__file__).resolve().parents[1]


def test_history_keeps_previous_code_and_excludes_failed_current_work(
    tmp_path: Path,
) -> None:
    store = Store(tmp_path)
    for index in range(5):
        store.save_study(
            f"2026-09-0{index + 1}-0",
            "moss",
            {
                "python": f"version = {index}",
                "rendered": index != 3,
                "title": str(index),
                "memory": "change the rhythm",
            },
        )
    history = store.history("moss", "2026-09-05-0")
    assert [entry["title"] for entry in history] == ["2", "1", "0"]
    assert history_context(history)[0]["python"] == "version = 2"


def test_large_history_is_bounded_and_marks_omitted_code() -> None:
    context = history_context(
        [{"title": "one", "python": "x" * 20000, "memory": "leave room"}], 1000
    )
    assert "python" not in context[0]
    assert context[0]["code_omitted"]
    assert len(json.dumps(context).encode()) <= 1000


def test_peer_choice_uses_only_another_artists_published_previous_work(
    tmp_path: Path,
) -> None:
    store = Store(tmp_path)
    for name in ("moss", "kite", "reed"):
        store.save_musician(
            name, json.loads((ROOT / "profiles" / f"{name}.json").read_text())
        )
    for name in ("moss", "kite", "reed"):
        store.save_study(
            "2026-09-01-0",
            name,
            {
                "title": name,
                "python": "pass",
                "rendered": True,
                **({"track_id": 123} if name != "reed" else {}),
            },
        )
    peer = choose_peer(store, "moss", "2026-09-02-0")
    assert peer["id"] == "kite"
    assert peer["work"]["track_id"] == 123
    assert "python" not in peer["work"]
    assert peer["probabilities"] == {"kite": 1.0}


def test_composition_context_excludes_visual_profile_instructions() -> None:
    profile = Musician.model_validate(
        json.loads((ROOT / "profiles/moss.json").read_text())["profile"]
    )
    context = musical_identity(profile)
    assert "avatar_prompt" not in context and "bio" not in context
    assert context["inspirations"] == [i.model_dump() for i in profile.inspirations]
    assert context["ethos"] == profile.ethos


def test_planning_history_keeps_lessons_without_old_synthesis() -> None:
    history = [
        {
            "python": "old oscillator code",
            "memory": "bass masks melody",
            "musical_plan": {"motif": "D F E D"},
        }
    ]
    context = history_context(history, include_code=False)
    assert context == [
        {"memory": "bass masks melody", "musical_plan": {"motif": "D F E D"}}
    ]
