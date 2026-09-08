import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

import compose
from compose import parse_composition
from studio.identity import Musician
from studio.state import Store


def test_metadata_is_read_without_executing_composer_code() -> None:
    piece = parse_composition(
        'TITLE="one"\nIDEA="two"\nMEMORY="Try a shorter bass phrase"\nKEEP_PEER=True\nraise RuntimeError("never execute on the host")'
    )
    assert piece.keep_peer
    assert piece.memory == "Try a shorter bass phrase"
    assert piece.taste is None


def test_executable_metadata_is_not_evaluated() -> None:
    with pytest.raises(ValueError):
        parse_composition('TITLE=__import__("os").getcwd()\nIDEA="two"')


def test_inspirations_can_change_but_cannot_be_cleared() -> None:
    with pytest.raises(ValidationError):
        parse_composition('TITLE="one"\nIDEA="two"\nINSPIRATIONS=[]')


def test_musical_plan_is_validated_and_reused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = Store(tmp_path)
    profile = Musician.model_validate(
        json.loads((Path(__file__).parents[1] / "profiles/reed.json").read_text())[
            "profile"
        ]
    )
    response = {
        "tempo_bpm": 96,
        "meter": "4/4, four bars in ten seconds",
        "tonal_organization": "D minor, Dm to Gm with stepwise inner voices",
        "motif": "D F E D, eighth eighth quarter half; answer an octave below",
        "instrument_roles": [
            "mid-register pluck melody",
            "bass roots on beats one and three",
        ],
        "development": "Repeat the first phrase, then answer it and land on D.",
    }
    requests = []

    def request(prompt: str, *_args: object) -> str:
        requests.append(prompt)
        return json.dumps(response)

    monkeypatch.setattr(compose, "request_music", request)
    first = compose.plan_music(profile, [], store, "session", "reed")
    second = compose.plan_music(profile, [], store, "session", "reed")
    assert first == second
    assert len(requests) == 1
    assert store.study("session", "reed")["musical_plan"]["tempo_bpm"] == 96
    response["tempo_bpm"] = -1
    with pytest.raises(ValidationError):
        compose.plan_music(profile, [], store, "other-session", "reed")
    assert store.study("other-session", "reed") is None


@pytest.mark.parametrize("repair_valid", [True, False])
def test_syntax_repair_is_bounded_and_charged(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, repair_valid: bool
) -> None:
    store = Store(tmp_path)
    profile = Musician.model_validate(
        json.loads((Path(__file__).parents[1] / "profiles/reed.json").read_text())[
            "profile"
        ]
    )
    plan = compose.MusicalPlan(
        tempo_bpm=96,
        meter="4/4",
        tonal_organization="D minor with a fixed D bass pedal",
        motif="D F E D in eighth notes, followed by a rest",
        instrument_roles=["pluck melody"],
        development="Repeat the phrase, then answer and resolve to D.",
    )
    monkeypatch.setattr(compose, "plan_music", lambda *_args: plan)
    session = store.reserve(datetime.now(UTC))
    assert session
    broken = 'TITLE="one"\nIDEA="two"\nx = (0. fifty if False else 0.52)'
    fixed = 'TITLE="one"\nIDEA="two"\nx = 0.52'
    prompts: list[str] = []

    def request(prompt: str, ledger: Store, key: str) -> str:
        ledger.call(key)
        ledger.charge(key, 0.001)
        prompts.append(prompt)
        return fixed if repair_valid and len(prompts) == 2 else broken

    monkeypatch.setattr(compose, "request_music", request)
    if repair_valid:
        assert (
            compose.compose(profile, [], store, session, musician_id="reed").python
            == fixed
        )
    else:
        with pytest.raises(SyntaxError):
            compose.compose(profile, [], store, session, musician_id="reed")
    assert len(prompts) == 2
    assert "Compiler error:" in prompts[1] and broken in prompts[1]
    assert store.study(session, "reed")["syntax_failure"]["source"] == broken
    with store.connect() as db:
        assert db.execute("SELECT calls,spent FROM sessions").fetchone() == (2, 0.002)
