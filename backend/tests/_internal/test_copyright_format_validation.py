"""regression tests for the IPI / ISWC / ISRC format validators.

verifies the pydantic patterns anchor at the lexicon-shape layer
(ch_indiemusi.models). without these the API would happily forward garbage
strings to the user's PDS as rights records.

formats anchored to:
- IPI Name Number: CISAC — 11 numeric digits
- ISWC: T + 9 digits + check digit, hyphens or periods conventional
- ISRC: CC (2 letters) + XXX (3 alnum) + YY (2 digits) + NNNNN (5 digits)
"""

import pytest
from pydantic import ValidationError

from backend._internal.atproto.records.ch_indiemusi import (
    PublishingOwnerInput,
)
from backend._internal.copyright import TrackRightsInput

# --- IPI ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "ipi",
    [
        "01145982828",  # Hilke's IPI
        "00591706432",  # Anna Murphy
        "00380771742",  # Red Brick Records
        "00045620792",  # Prince (Wikipedia example)
    ],
)
def test_ipi_accepts_canonical_11_digits(ipi: str) -> None:
    PublishingOwnerInput.model_validate({"ipi": ipi})


@pytest.mark.parametrize(
    "ipi",
    [
        "asdfasdf",  # garbage from the screenshot
        "123456789",  # 9 digits (deprecated CAE format)
        "1234567890",  # 10 digits
        "123456789012",  # 12 digits
        "0114598282A",  # letter in last position
        "01145 982828",  # space
        "01145-982828",  # hyphen
    ],
)
def test_ipi_rejects_non_canonical(ipi: str) -> None:
    with pytest.raises(ValidationError):
        PublishingOwnerInput.model_validate({"ipi": ipi})


def test_ipi_none_allowed() -> None:
    """ipi is optional — absent or null is fine."""
    PublishingOwnerInput.model_validate({})
    PublishingOwnerInput.model_validate({"ipi": None})


# --- ISWC --------------------------------------------------------------------


@pytest.mark.parametrize(
    "iswc",
    [
        "T-330690274-5",  # Hilke's "soul" — hyphens (13 chars)
        "T3306902745",  # no separators (11 chars)
        "T-3306902745",  # hyphen prefix only (12 chars)
        "T-000000001-0",  # canonical Dancing Queen, hyphens only
    ],
)
def test_iswc_accepts_canonical_shapes(iswc: str) -> None:
    TrackRightsInput.model_validate({"iswc": iswc})


@pytest.mark.parametrize(
    "iswc",
    [
        "asdf",  # garbage
        "330690274-5",  # missing T prefix
        "t-330690274-5",  # lowercase t (spec is uppercase)
        "T-33069027-5",  # 8 digits not 9
        "T-330690274",  # missing check digit
        "T-330_690_274-5",  # invalid separator (underscore)
        "T-330,690,274-5",  # commas (not allowed)
        # period-grouped form is spec-valid for presentation but is 15 chars,
        # over the lexicon's maxLength=13 — users must strip dots first
        "T-000.000.001-0",
    ],
)
def test_iswc_rejects_non_canonical(iswc: str) -> None:
    with pytest.raises(ValidationError):
        TrackRightsInput.model_validate({"iswc": iswc})


# --- ISRC --------------------------------------------------------------------


@pytest.mark.parametrize(
    "isrc",
    [
        "CHD542500009",  # Hilke's recording — no separators, 12 chars
        "USRC17607839",  # generic US ISRC
        "QMT0X2342342",  # special distributor code QM (post-2010 US overflow)
        "GBAYE8600001",  # UK example, no separators
    ],
)
def test_isrc_accepts_canonical_shapes(isrc: str) -> None:
    TrackRightsInput.model_validate({"isrc": isrc})


@pytest.mark.parametrize(
    "isrc",
    [
        "asdfasdfsda",  # garbage
        "chd542500009",  # lowercase — spec is uppercase
        "CHD54250000",  # 11 chars (1 too short)
        "CHD5425000099",  # 13 chars (1 too long)
        "CH-D54-AA-00009",  # non-digit year
        "CH-D54-25-0000A",  # non-digit designation
        # hyphenated presentation form is 15 chars, over the lexicon's
        # maxLength=12 — users must strip hyphens before submitting
        "CH-D54-25-00009",
    ],
)
def test_isrc_rejects_non_canonical(isrc: str) -> None:
    with pytest.raises(ValidationError):
        TrackRightsInput.model_validate({"isrc": isrc})
