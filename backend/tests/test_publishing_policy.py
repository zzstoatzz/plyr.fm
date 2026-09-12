"""Publishing snapshots and independent action authorization."""

import pytest
from pydantic import ValidationError

from backend.utilities.publishing import (
    PublishingDefaults,
    PublishingPolicy,
    resolve_publishing,
)


def test_rights_template_does_not_change_access() -> None:
    assert PublishingDefaults(attach_rights=True).access == PublishingPolicy()


def test_public_blob_eligibility_requires_both_public_actions() -> None:
    assert not PublishingPolicy(downloads="ask").requires_protected_audio
    assert PublishingPolicy(downloads="supporters").requires_protected_audio
    assert PublishingPolicy(listening="signed_in").requires_protected_audio


def test_private_metadata_cannot_claim_public_listening() -> None:
    with pytest.raises(ValidationError, match="restricted audience"):
        PublishingPolicy(visibility="private")


def test_unknown_policy_fields_are_rejected() -> None:
    with pytest.raises(ValidationError, match="Extra inputs"):
        PublishingPolicy.model_validate({"copyright": True})


def test_album_and_track_overrides_resolve_to_persisted_snapshots() -> None:
    portal = PublishingDefaults()
    album = PublishingDefaults(access=PublishingPolicy(downloads="off"))
    track = PublishingDefaults(access=PublishingPolicy(downloads="supporters"))
    published = resolve_publishing(portal=portal, album=album, track=track)
    assert published.origin == "track"
    assert published.settings.access.downloads == "supporters"
    assert resolve_publishing(portal=portal, album=album).origin == "album"
    assert resolve_publishing(portal=portal).origin == "portal"
    changed_portal = PublishingDefaults(access=PublishingPolicy(listening="owner"))
    assert resolve_publishing(portal=changed_portal).settings != published.settings
    assert published.settings.access == track.access
