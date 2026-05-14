"""tests for the ch.indiemusi.alpha record builders.

we test the build_* helpers (pure functions producing the dict that gets sent
to the PDS) — these are the bits where a bug shows up as a malformed record
that the PDS rejects or, worse, accepts as semantically wrong.

shapes are anchored to real records from did:plc:giaakn4axmr5dhfnvha6r6wn
(hilk.eu, the lexicon author) so any drift between our writer and what real
indiemusi clients write is caught.
"""

import pytest
from pydantic import ValidationError

from backend._internal.atproto.records.ch_indiemusi import (
    InterestedPartyInput,
    PublishingOwnerInput,
    RecordingArtistInput,
    RecordingInput,
    SongInput,
    build_publishing_owner_record,
    build_recording_record,
    build_song_record,
)
from backend.config import settings

# --- publishingOwner ---------------------------------------------------------


def test_publishing_owner_record_individual() -> None:
    """individual (firstName/lastName) shape matches the lexicon and the real record."""
    record = build_publishing_owner_record(
        PublishingOwnerInput.model_validate(
            {
                "ipi": "01145982828",
                "firstName": "Hilke",
                "lastName": "Ros",
                "collectingSociety": "Suisa",
            }
        )
    )
    assert record == {
        "$type": "ch.indiemusi.alpha.actor.publishingOwner",
        "ipi": "01145982828",
        "firstName": "Hilke",
        "lastName": "Ros",
        "collectingSociety": "Suisa",
    }


def test_publishing_owner_record_company() -> None:
    """company (companyName) shape — distinct path, both should be supported."""
    record = build_publishing_owner_record(
        PublishingOwnerInput.model_validate(
            {
                "ipi": "00380771742",
                "companyName": "Red Brick Records",
                "collectingSociety": "Suisa",
            }
        )
    )
    assert record["companyName"] == "Red Brick Records"
    assert "firstName" not in record
    assert "lastName" not in record


def test_publishing_owner_omits_nulls() -> None:
    """unset optional fields must not appear in the record body."""
    record = build_publishing_owner_record(
        PublishingOwnerInput.model_validate({"firstName": "Hilke"})
    )
    assert set(record.keys()) == {"$type", "firstName"}


# --- song --------------------------------------------------------------------


def _hilke_soul_song_input() -> SongInput:
    """recreate Hilke's 'soul' song record as a SongInput, to verify shape parity."""
    return SongInput.model_validate(
        {
            "title": "soul",
            "iswc": "T-330690274-5",
            "interestedParties": [
                {
                    "did": "did:plc:giaakn4axmr5dhfnvha6r6wn",
                    "ipi": "01145982828",
                    "name": "Hilke Ros",
                    "role": "author, composer",
                    "collectingSociety": "Suisa",
                    "mechanicalRoyaltiesPercentage": 4750,
                    "performanceRoyaltiesPercentage": 6334,
                    "publishingOwner": {
                        "ipi": "01145982828",
                        "firstName": "Hilke",
                        "lastName": "Ros",
                        "collectingSociety": "Suisa",
                    },
                },
                {
                    "ipi": "00591706432",
                    "name": "Anna Murphy",
                    "role": "arranger",
                    "collectingSociety": "Suisa",
                    "mechanicalRoyaltiesPercentage": 250,
                    "performanceRoyaltiesPercentage": 333,
                },
                {
                    "did": "did:plc:wkatvmhpoodroywh52bbemeh",
                    "ipi": "00380771742",
                    "name": "Red Brick Records",
                    "role": "publisher",
                    "collectingSociety": "Suisa",
                    "mechanicalRoyaltiesPercentage": 5000,
                    "performanceRoyaltiesPercentage": 3333,
                    "publishingOwner": {
                        "ipi": "00380771742",
                        "companyName": "Red Brick Records",
                        "collectingSociety": "Suisa",
                    },
                },
            ],
        }
    )


def test_song_record_matches_real_record_shape() -> None:
    """builds a record byte-equivalent to Hilke's actual 'soul' record."""
    record = build_song_record(_hilke_soul_song_input())

    assert record["$type"] == "ch.indiemusi.alpha.song"
    assert record["title"] == "soul"
    assert record["iswc"] == "T-330690274-5"
    assert len(record["interestedParties"]) == 3

    hilke = record["interestedParties"][0]
    assert hilke["role"] == "author, composer"
    assert hilke["mechanicalRoyaltiesPercentage"] == 4750
    assert hilke["publishingOwner"] == {
        "$type": "ch.indiemusi.alpha.actor.publishingOwner",
        "ipi": "01145982828",
        "firstName": "Hilke",
        "lastName": "Ros",
        "collectingSociety": "Suisa",
    }

    # co-writer without publishingOwner stays without it (don't synthesize one)
    anna = record["interestedParties"][1]
    assert "publishingOwner" not in anna
    assert "did" not in anna  # not all co-writers have a DID

    # publisher entry inlines its publishingOwner with companyName variant
    rbr = record["interestedParties"][2]
    assert rbr["publishingOwner"]["companyName"] == "Red Brick Records"


def test_song_requires_at_least_one_interested_party() -> None:
    with pytest.raises(ValidationError):
        SongInput.model_validate({"title": "x", "interestedParties": []})


def test_song_iswc_max_length() -> None:
    with pytest.raises(ValidationError):
        SongInput.model_validate(
            {
                "title": "x",
                "iswc": "T-" + "1" * 20,  # too long
                "interestedParties": [{"name": "x"}],
            }
        )


def test_royalty_basis_points_bounds() -> None:
    """basis points must be in [0, 10000]; 100% is 10000, not 100."""
    with pytest.raises(ValidationError):
        InterestedPartyInput.model_validate(
            {"name": "x", "mechanicalRoyaltiesPercentage": 10001}
        )
    with pytest.raises(ValidationError):
        InterestedPartyInput.model_validate(
            {"name": "x", "performanceRoyaltiesPercentage": -1}
        )


# --- recording ---------------------------------------------------------------


def test_recording_record_shape() -> None:
    record = build_recording_record(
        RecordingInput.model_validate(
            {
                "title": "soul",
                "isrc": "CHD542500009",
                "duration": 208,
                "artists": [
                    {
                        "did": "did:plc:giaakn4axmr5dhfnvha6r6wn",
                        "name": "Hilke",
                    }
                ],
                "masterOwner": {
                    "did": "did:plc:wkatvmhpoodroywh52bbemeh",
                    "name": "Red Brick Records",
                },
            }
        )
    )
    assert record["$type"] == "ch.indiemusi.alpha.recording"
    assert record["isrc"] == "CHD542500009"
    assert record["duration"] == 208
    assert record["artists"] == [
        {"did": "did:plc:giaakn4axmr5dhfnvha6r6wn", "name": "Hilke"}
    ]
    assert record["masterOwner"] == {
        "did": "did:plc:wkatvmhpoodroywh52bbemeh",
        "name": "Red Brick Records",
    }
    # song is optional and not present here
    assert "song" not in record
    # we never emit audioFile — copyright tracks live in private storage
    assert "audioFile" not in record


def test_recording_inlines_song_when_provided() -> None:
    """when a song input is supplied, recording.song is the inline song body."""
    record = build_recording_record(
        RecordingInput.model_validate(
            {
                "title": "soul",
                "artists": [{"name": "Hilke"}],
                "song": {
                    "title": "soul",
                    "iswc": "T-330690274-5",
                    "interestedParties": [{"name": "Hilke Ros", "role": "author"}],
                },
            }
        )
    )
    assert record["song"]["$type"] == "ch.indiemusi.alpha.song"
    assert record["song"]["title"] == "soul"
    assert record["song"]["iswc"] == "T-330690274-5"


def test_recording_requires_artists() -> None:
    with pytest.raises(ValidationError):
        RecordingInput.model_validate({"title": "x", "artists": []})


def test_artist_did_format_validated() -> None:
    with pytest.raises(ValidationError):
        RecordingArtistInput.model_validate({"name": "x", "did": "not-a-did"})


# --- scope tokens ------------------------------------------------------------


def test_indiemusi_scope_tokens() -> None:
    """scope tokens cover the three collections we write to."""
    tokens = settings.indiemusi.scope_tokens()
    assert f"repo:{settings.indiemusi.song_collection}" in tokens
    assert f"repo:{settings.indiemusi.recording_collection}" in tokens
    assert f"repo:{settings.indiemusi.publishing_owner_collection}" in tokens


def test_indiemusi_collections_under_configured_namespace() -> None:
    """collections derive from the configurable namespace so env-overrides work."""
    ns = settings.indiemusi.namespace
    assert settings.indiemusi.song_collection == f"{ns}.song"
    assert settings.indiemusi.recording_collection == f"{ns}.recording"
    assert (
        settings.indiemusi.publishing_owner_collection == f"{ns}.actor.publishingOwner"
    )
