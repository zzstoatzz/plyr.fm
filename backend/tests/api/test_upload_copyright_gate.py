"""regression test: copyright-gated uploads must not require atprotofans setup.

bug seen on staging 2026-05-15: a track upload with the copyright toggle
flipped on failed in the docket worker's `_validate_audio` phase with
"supporter gating requires atprotofans to be enabled in settings". the
validator was scoping atprotofans-required to `support_gate is not None`
instead of `support_gate.type == "any"`, so copyright-typed gates
(`{"type": "copyright"}`) triggered the same check even though copyright
access doesn't depend on atprotofans at all.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend.api.tracks.uploads import (
    UploadContext,
    UploadPhaseError,
    _validate_audio,
)
from backend.models import Artist


def _ctx(
    artist_did: str, *, support_gate: dict | None, filename: str = "test.mp3"
) -> UploadContext:
    """build a minimal UploadContext for _validate_audio."""
    return UploadContext(
        upload_id="test-upload-id",
        auth_session=Session.__new__(Session),
        audio_file_id="test_file_id",
        filename=filename,
        duration=60,
        title="test track",
        artist_did=artist_did,
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
        support_gate=support_gate,
    )


async def test_copyright_gate_does_not_require_atprotofans(
    db_session: AsyncSession,
) -> None:
    """the original bug: copyright-typed gate must pass validation without
    the user having atprotofans configured.
    """
    did = "did:test:copyright-no-fans"
    db_session.add(Artist(did=did, handle="someone.example", display_name="Someone"))
    await db_session.commit()
    # no UserPreferences row at all — definitely no atprotofans setup

    ctx = _ctx(did, support_gate={"type": "copyright"})
    info = await _validate_audio(ctx)
    # validation must pass; the upload would continue into _store_audio
    assert info.is_gated is True


async def test_supporter_gate_still_requires_atprotofans(
    db_session: AsyncSession,
) -> None:
    """the original guard for supporter gating remains: type=="any" without
    atprotofans configured must still raise.
    """
    did = "did:test:supporter-no-fans"
    db_session.add(Artist(did=did, handle="someone-else.example", display_name="Other"))
    await db_session.commit()

    ctx = _ctx(did, support_gate={"type": "any"})
    with pytest.raises(UploadPhaseError, match="atprotofans"):
        await _validate_audio(ctx)


async def test_public_upload_skips_atprotofans_check(
    db_session: AsyncSession,
) -> None:
    """public uploads (support_gate=None) never touch the user_preferences check."""
    did = "did:test:public-upload"
    db_session.add(Artist(did=did, handle="public.example", display_name="Public"))
    await db_session.commit()

    ctx = _ctx(did, support_gate=None)
    info = await _validate_audio(ctx)
    assert info.is_gated is False
