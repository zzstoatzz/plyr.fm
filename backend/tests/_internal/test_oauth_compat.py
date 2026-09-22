"""OAuth provider interoperability regressions."""

from atproto_oauth.client import _scopes_are_equivalent

from backend._internal.auth.oauth import get_oauth_client
from backend._internal.auth.oauth_compat import (
    BlackskyCompatibleOAuthClient,
    normalize_token_scope,
)

_REQUESTED_SCOPE = (
    "atproto blob:*/* include:fm.plyr.authFullApp include:fm.plyr.privateMediaAccess"
)
_BLACKSKY_SCOPE = (
    "atproto blob:*/* "
    "repo:?collection=fm.plyr.track&collection=fm.plyr.like&"
    "collection=fm.plyr.comment&collection=fm.plyr.list&"
    "collection=fm.plyr.actor.profile&action=create&action=update&action=delete "
    "space:fm.plyr.privateMedia?authority=self&skey=self&"
    "collection=fm.plyr.track&action=read&action=create&action=update&"
    "action=delete&manage=create&manage=update&manage=delete "
    "space:fm.plyr.privateMedia?authority=*&skey=self&"
    "collection=fm.plyr.track&action=read"
)


def test_blacksky_scope_normalization_restores_semantic_validation() -> None:
    assert not _scopes_are_equivalent(_REQUESTED_SCOPE, _BLACKSKY_SCOPE)

    normalized = normalize_token_scope("https://blacksky.app", _BLACKSKY_SCOPE)

    assert "repo:?" not in normalized
    assert _scopes_are_equivalent(_REQUESTED_SCOPE, normalized)


def test_scope_normalization_is_limited_to_blacksky() -> None:
    assert (
        normalize_token_scope("https://other.example", _BLACKSKY_SCOPE)
        == _BLACKSKY_SCOPE
    )


def test_oauth_client_uses_blacksky_compatibility() -> None:
    assert isinstance(get_oauth_client(), BlackskyCompatibleOAuthClient)
