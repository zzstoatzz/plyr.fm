"""ATProto creator self-label parsing and record construction."""

import json
from collections.abc import Iterable
from typing import Any, cast

SELF_LABELS_TYPE = "com.atproto.label.defs#selfLabels"
MAX_SELF_LABELS = 10
MAX_SELF_LABEL_LENGTH = 128


def normalize_self_label_values(values: object) -> list[str]:
    """Return valid, de-duplicated self-label values in source order."""
    if not isinstance(values, list):
        return []
    value_list = cast(list[object], values)

    normalized: list[str] = []
    for value in value_list[:MAX_SELF_LABELS]:
        if (
            not isinstance(value, str)
            or not value
            or len(value) > MAX_SELF_LABEL_LENGTH
        ):
            continue
        if value not in normalized:
            normalized.append(value)
    return normalized


def self_label_values_from_record(labels: object) -> list[str]:
    """Extract creator values from a `com.atproto.label.defs#selfLabels` object."""
    if not isinstance(labels, dict):
        return []
    label_map = cast(dict[str, object], labels)
    label_type = label_map.get("$type")
    if label_type not in (None, SELF_LABELS_TYPE):
        return []
    raw_values = label_map.get("values")
    if not isinstance(raw_values, list):
        return []
    values: list[object] = []
    for entry in cast(list[object], raw_values):
        if isinstance(entry, dict):
            values.append(cast(dict[str, object], entry).get("val"))
    return normalize_self_label_values(values)


def build_self_labels(values: Iterable[str]) -> dict[str, Any] | None:
    """Build the standard ATProto self-label object, or omit it when empty."""
    normalized = normalize_self_label_values(list(values))
    if not normalized:
        return None
    return {
        "$type": SELF_LABELS_TYPE,
        "values": [{"val": value} for value in normalized],
    }


def parse_self_label_values_json(raw: str | None) -> list[str]:
    """Parse a strict JSON-array form field containing creator label values."""
    if raw is None:
        return []
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("self_labels must be a JSON array") from exc
    if not isinstance(values, list):
        raise ValueError("self_labels must be a JSON array")
    if len(values) > MAX_SELF_LABELS:
        raise ValueError(f"self_labels supports at most {MAX_SELF_LABELS} values")
    if any(
        not isinstance(value, str) or not value or len(value) > MAX_SELF_LABEL_LENGTH
        for value in values
    ):
        raise ValueError(
            f"self_labels values must be non-empty strings up to {MAX_SELF_LABEL_LENGTH} characters"
        )
    return normalize_self_label_values(values)
