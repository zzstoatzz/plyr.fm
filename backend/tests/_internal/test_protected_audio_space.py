"""the protected audio playback space's policy on the artist's PDS."""

from unittest.mock import AsyncMock

import pytest

from backend._internal import Session
from backend._internal.atproto.spaces import client as space_client
from backend._internal.atproto.spaces import protected_audio
from backend._internal.atproto.spaces.uris import build_space_uri
from backend.config import settings


async def test_playback_space_uses_public_read_memberspace_for_plyr_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings.atproto, "client_id", "https://plyr.test/client.json")
    monkeypatch.setattr(
        protected_audio, "create_space_client_attestation", lambda audience: "jwt"
    )
    policy = {
        "$type": "com.atproto.memberspace.policy",
        "publicRead": True,
        "publicWrite": False,
        "allowedApps": ["https://plyr.test/client.json"],
        "publishPolicy": False,
        "publishMembers": False,
    }
    session = Session(
        session_id="s",
        did="did:plc:x",
        handle="x.test",
        oauth_session={"pds_url": "https://x"},
    )
    space = build_space_uri(
        session.did, settings.atproto.private_media_space_type, "playback"
    )
    request = AsyncMock(side_effect=[{"uri": space}, {"uri": space, "policy": policy}])
    monkeypatch.setattr(protected_audio, "make_pds_request", request)

    assert await protected_audio.ensure_playback_space(session) == space
    assert request.await_args_list[0].args[2] == "com.atproto.space.createSpace"
    assert request.await_args_list[0].kwargs["payload"]["policy"] == policy
    assert request.await_args_list[1].args[2] == "com.atproto.space.getSpace"

    drifted = {**policy, "allowedApps": ["https://other.test/client.json"]}
    request = AsyncMock(
        side_effect=[Exception("SpaceAlreadyExists"), {"uri": space, "policy": drifted}]
    )
    monkeypatch.setattr(protected_audio, "make_pds_request", request)
    with pytest.raises(space_client.SpaceAccessError):
        await protected_audio.ensure_playback_space(session)
