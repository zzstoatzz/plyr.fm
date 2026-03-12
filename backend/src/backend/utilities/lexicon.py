"""ATProto lexicon record validation.

validates records against the lexicon JSON schemas in the repo's
``lexicons/`` directory. intended for ingest-time screening — lenient
on unknown fields and unknown lexicon IDs (pass-through).
"""

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

from atproto_core.nsid import NSID

logger = logging.getLogger(__name__)


def _find_lexicons_dir() -> Path:
    """locate the lexicons directory, searching upward from this file."""
    current = Path(__file__).resolve().parent
    for _ in range(8):
        candidate = current / "lexicons"
        if candidate.is_dir():
            return candidate
        current = current.parent
    return Path("/app/lexicons")


_LEXICONS_DIR = _find_lexicons_dir()


@lru_cache(maxsize=32)
def _load_lexicon(lexicon_id: str) -> dict[str, Any] | None:
    """load a lexicon JSON by its NSID, using the last segment as filename."""
    filename = NSID.from_str(lexicon_id).name + ".json"
    path = _LEXICONS_DIR / filename
    if not path.exists():
        logger.debug("lexicon file not found: %s", path)
        return None
    with open(path) as f:
        return json.load(f)


def _get_record_schema(lexicon: dict[str, Any]) -> dict[str, Any] | None:
    """extract the record schema from defs.main.record."""
    return lexicon.get("defs", {}).get("main", {}).get("record")


def _validate_property(key: str, value: Any, prop_schema: dict[str, Any]) -> list[str]:
    """validate a single property value against its schema definition."""
    errors: list[str] = []
    prop_type = prop_schema.get("type", "")

    # type checks
    if prop_type == "string":
        if not isinstance(value, str):
            errors.append(f"{key}: expected string, got {type(value).__name__}")
            return errors
        if (min_len := prop_schema.get("minLength")) is not None and len(
            value
        ) < min_len:
            errors.append(f"{key}: length {len(value)} < minLength {min_len}")
        if (max_len := prop_schema.get("maxLength")) is not None and len(
            value
        ) > max_len:
            errors.append(f"{key}: length {len(value)} > maxLength {max_len}")

    elif prop_type == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            errors.append(f"{key}: expected integer, got {type(value).__name__}")
            return errors
        if (minimum := prop_schema.get("minimum")) is not None and value < minimum:
            errors.append(f"{key}: value {value} < minimum {minimum}")

    elif prop_type == "array":
        if not isinstance(value, list):
            errors.append(f"{key}: expected array, got {type(value).__name__}")
            return errors
        if (max_len := prop_schema.get("maxLength")) is not None and len(
            value
        ) > max_len:
            errors.append(f"{key}: length {len(value)} > maxLength {max_len}")

    elif prop_type in ("object", "blob"):
        if not isinstance(value, dict):
            errors.append(f"{key}: expected {prop_type}, got {type(value).__name__}")

    elif prop_type == "ref":
        ref = prop_schema.get("ref", "")
        if ref == "com.atproto.repo.strongRef":
            if not isinstance(value, dict):
                errors.append(
                    f"{key}: expected strongRef object, got {type(value).__name__}"
                )
            elif not isinstance(value.get("uri"), str):
                errors.append(f"{key}: strongRef missing 'uri' string")

    return errors


def validate_record(
    lexicon_id: str,
    record: dict[str, Any],
    *,
    partial: bool = False,
) -> list[str]:
    """validate a record dict against its lexicon schema.

    returns a list of error strings. empty list means the record is valid.
    never raises — unknown lexicons pass through with no errors.

    args:
        lexicon_id: fully-qualified NSID (e.g. "fm.plyr.track")
        record: the ATProto record data
        partial: if True, skip required-field checks (for update operations)
    """
    lexicon = _load_lexicon(lexicon_id)
    if lexicon is None:
        return []

    schema = _get_record_schema(lexicon)
    if schema is None:
        return []

    errors: list[str] = []

    # required field checks (skip for partial/update)
    if not partial:
        for field in schema.get("required", []):
            if field not in record:
                errors.append(f"missing required field: {field}")

    # property validation
    properties = schema.get("properties", {})
    for key, value in record.items():
        if key in properties:
            errors.extend(_validate_property(key, value, properties[key]))

    return errors
