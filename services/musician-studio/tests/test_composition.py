import json
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
