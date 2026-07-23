"""Creator self-label parsing, serialization, and effective-label policy."""

from unittest.mock import AsyncMock, patch

import pytest

from backend._internal.atproto.self_labels import (
    SELF_LABELS_TYPE,
    build_self_labels,
    normalize_self_label_values,
    parse_self_label_values_json,
    self_label_values_from_record,
)
from backend._internal.content_labels import (
    get_operator_label_values,
    get_track_label_values,
)
from backend.models import Track


def test_self_label_values_round_trip_and_deduplicate() -> None:
    labels = build_self_labels(["sexual", "sexual", "porn"])

    assert labels == {
        "$type": SELF_LABELS_TYPE,
        "values": [{"val": "sexual"}, {"val": "porn"}],
    }
    assert self_label_values_from_record(labels) == ["sexual", "porn"]


def test_self_label_parser_rejects_non_array_json() -> None:
    with pytest.raises(ValueError, match="JSON array"):
        parse_self_label_values_json('{"val": "sexual"}')


def test_normalize_self_labels_preserves_valid_unknown_values() -> None:
    assert normalize_self_label_values(["sexual", "community:spoiler", 42, ""]) == [
        "sexual",
        "community:spoiler",
    ]


async def test_operator_label_values_query_labeler_live() -> None:
    track = Track(
        id=1177,
        title="creator labeled",
        artist_did="did:plc:creator",
        file_id="creator_labeled",
        file_type="mp3",
        atproto_record_uri="at://did:plc:creator/fm.plyr.track/explicit",
        self_labels=["sexual"],
    )
    moderation = AsyncMock()
    moderation.get_active_label_values.return_value = {
        track.atproto_record_uri: {"porn", "operator:reviewed"}
    }

    with patch(
        "backend._internal.content_labels.get_moderation_client",
        return_value=moderation,
    ):
        operator_values = await get_operator_label_values([track])

    assert operator_values[track.id] == {"porn", "operator:reviewed"}


def test_effective_labels_union_creator_and_projected_operator_provenance() -> None:
    """get_track_label_values reads only columns — self labels union the
    operator-label projection, with no live labeler query."""
    track = Track(
        id=1178,
        title="creator labeled",
        artist_did="did:plc:creator",
        file_id="creator_labeled",
        file_type="mp3",
        atproto_record_uri="at://did:plc:creator/fm.plyr.track/explicit",
        self_labels=["sexual"],
        operator_labels=["porn"],
    )

    assert get_track_label_values([track])[track.id] == {"sexual", "porn"}
