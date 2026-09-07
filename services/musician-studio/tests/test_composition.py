import pytest
from pydantic import ValidationError

from compose import parse_composition


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
