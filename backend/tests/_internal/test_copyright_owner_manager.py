"""regression tests for the publishingOwner record manager.

covers the contracts that aren't exercised by the existing copyright tests:

- `merge_publishing_owner_for_put` preserves keys plyr doesn't model
  (the whole point of fetching fresh before edit)
- individual ↔ company switches actually clear the stale shape, not leave
  firstName lingering after a switch to companyName
- `_normalize_pending_paradigm_data` back-compat shim wraps the legacy flat
  shape as a `create` action (covers in-flight pending rows during deploy)
"""

import pytest

from backend._internal.atproto.records.ch_indiemusi import (
    KNOWN_OWNER_KEYS,
    PublishingOwnerInput,
    merge_publishing_owner_for_put,
)
from backend._internal.copyright import _normalize_pending_paradigm_data

# --- merge-preserve --------------------------------------------------------


def test_merge_preserves_unknown_fields() -> None:
    """fields not modeled by plyr survive a round-trip through edit."""
    fresh = {
        "$type": "ch.indiemusi.alpha.actor.publishingOwner",
        "firstName": "Hilke",
        "lastName": "Ros",
        "ipi": "01145982828",
        "collectingSociety": "Suisa",
        # Hilke's hypothetical extensions plyr doesn't model:
        "taxId": "CHE-123.456.789",
        "notes": "primary identity for solo work",
    }
    edited = PublishingOwnerInput.model_validate(
        {"firstName": "Hilke", "lastName": "Ros", "ipi": "01145982829"}
    )
    merged = merge_publishing_owner_for_put(fresh, edited)

    # known fields reflect the edit (ipi changed last digit)
    assert merged["ipi"] == "01145982829"
    assert merged["firstName"] == "Hilke"
    # unknown fields preserved untouched
    assert merged["taxId"] == "CHE-123.456.789"
    assert merged["notes"] == "primary identity for solo work"
    # $type always set
    assert merged["$type"] == "ch.indiemusi.alpha.actor.publishingOwner"
    # collectingSociety was on `fresh` but not in the edit — known-key
    # replacement should DROP it (intentional: blanks clear)
    assert "collectingSociety" not in merged


def test_merge_individual_to_company_clears_stale_keys() -> None:
    """switching individual → company drops firstName/lastName.

    naive `{...fresh, ...edit}` would keep firstName around forever once set.
    the known-key-replacement pattern catches this.
    """
    fresh = {
        "$type": "ch.indiemusi.alpha.actor.publishingOwner",
        "firstName": "Nathan",
        "lastName": "Nowack",
        "ipi": "00012345678",
        "collectingSociety": "ASCAP",
    }
    edited = PublishingOwnerInput.model_validate(
        {"companyName": "Plyr LLC", "collectingSociety": "ASCAP"}
    )
    merged = merge_publishing_owner_for_put(fresh, edited)

    assert merged["companyName"] == "Plyr LLC"
    assert "firstName" not in merged
    assert "lastName" not in merged
    assert "ipi" not in merged  # was on fresh but not in edit → cleared


def test_merge_company_to_individual_clears_stale_keys() -> None:
    """symmetric: switching company → individual drops companyName."""
    fresh = {
        "$type": "ch.indiemusi.alpha.actor.publishingOwner",
        "companyName": "Red Brick Records",
        "ipi": "00380771742",
    }
    edited = PublishingOwnerInput.model_validate(
        {"firstName": "Hilke", "lastName": "Ros"}
    )
    merged = merge_publishing_owner_for_put(fresh, edited)

    assert merged["firstName"] == "Hilke"
    assert merged["lastName"] == "Ros"
    assert "companyName" not in merged
    assert "ipi" not in merged


def test_known_owner_keys_covers_lexicon_shape() -> None:
    """if PublishingOwnerInput grows a new field, KNOWN_OWNER_KEYS must too,
    or merge-preserve will accidentally leave the new field as 'unknown' and
    skip clearing on switch.
    """
    model_fields = {
        f.alias if f.alias else name
        for name, f in PublishingOwnerInput.model_fields.items()
    }
    # KNOWN_OWNER_KEYS adds $type which the model doesn't carry as a field;
    # every modeled field's serialization alias must be in KNOWN_OWNER_KEYS.
    missing = model_fields - KNOWN_OWNER_KEYS
    assert not missing, (
        f"KNOWN_OWNER_KEYS missing {missing} — would skip clearing these on "
        f"individual↔company switches"
    )


# --- back-compat shim ------------------------------------------------------


def test_normalize_legacy_flat_shape_wraps_as_create() -> None:
    """pending rows stashed before the discriminator existed used the flat
    shape `{firstName, lastName, ipi, ...}`. wrap as create so the callback's
    new dispatch can handle them through the 10-min TTL window.
    """
    legacy = {
        "firstName": "Nathan",
        "lastName": "Nowack",
        "ipi": "00012345678",
        "collectingSociety": "ASCAP",
    }
    normalized = _normalize_pending_paradigm_data(legacy)
    assert normalized is not None
    assert normalized["action"] == "create"
    assert normalized["publishing_owner"] == legacy


def test_normalize_passes_through_discriminated_shape() -> None:
    """post-deploy pending rows already carry an `action` key — leave them alone."""
    new = {
        "action": "use",
        "uri": "at://did:plc:x/ch.indiemusi.alpha.actor.publishingOwner/abc",
    }
    assert _normalize_pending_paradigm_data(new) == new


def test_normalize_none_stays_none() -> None:
    assert _normalize_pending_paradigm_data(None) is None


@pytest.mark.parametrize(
    "action,data",
    [
        (
            "create",
            {
                "action": "create",
                "publishing_owner": {"firstName": "n", "lastName": "n"},
            },
        ),
        (
            "edit",
            {
                "action": "edit",
                "uri": "at://x/c/r",
                "publishing_owner": {"firstName": "n", "lastName": "n"},
            },
        ),
        ("use", {"action": "use", "uri": "at://x/c/r"}),
    ],
)
def test_normalize_preserves_action_shapes(action: str, data: dict) -> None:
    """parametrized roundtrip — each action shape passes through unchanged."""
    assert _normalize_pending_paradigm_data(data) == data
