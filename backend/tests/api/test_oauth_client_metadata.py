"""regression test: published OAuth client metadata must list every scope
the runtime can possibly request.

if the published `scope` doesn't include something the runtime sends as part
of a PAR (Pushed Authorization Request), the authserver returns 400
`invalid_scope` and the user can't sign in. we hit this when phase 2 added
the indiemusi scopes to runtime composition but the metadata endpoint kept
using the older teal-only composition — every fresh login that wanted
indiemusi scopes failed.

calls the endpoint handler directly (rather than going through AsyncClient)
so the test doesn't need redis / slowapi infrastructure to run locally.
"""

import pytest

from backend.api.meta import client_metadata
from backend.config import settings


async def _published_scope_tokens() -> set[str]:
    metadata = await client_metadata()
    return set(metadata["scope"].split())


async def test_oauth_metadata_declares_indiemusi_scopes() -> None:
    """every scope token the runtime can request must appear in the published
    scope universe — otherwise the authserver rejects the PAR.
    """
    declared = await _published_scope_tokens()

    # base atproto + blob (sanity)
    assert "atproto" in declared
    assert "blob:*/*" in declared

    # indiemusi paradigm scopes — the bug this guards against
    for token in settings.indiemusi.scope_tokens():
        assert token in declared, (
            f"indiemusi scope {token!r} missing from published OAuth metadata; "
            f"runtime can request it but PAR will be rejected as invalid_scope"
        )


async def test_oauth_metadata_declares_teal_scopes() -> None:
    """parallel guard for teal — same failure mode, different feature."""
    declared = await _published_scope_tokens()
    assert f"repo:{settings.teal.play_collection}" in declared
    assert f"repo:{settings.teal.status_collection}" in declared


async def test_oauth_metadata_omits_indiemusi_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """when the indiemusi paradigm is feature-disabled, those scopes must
    not be declared — declaring scopes we don't actually offer is sloppy
    (and may confuse downstream tools that audit grants).
    """
    monkeypatch.setattr(settings.indiemusi, "enabled", False)
    declared = await _published_scope_tokens()
    for token in settings.indiemusi.scope_tokens():
        assert token not in declared
