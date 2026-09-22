"""Targeted interoperability fixes for ATProto OAuth providers."""

import logging

from atproto_oauth import OAuthClient, OAuthState
from atproto_oauth.models import TokenResponse

logger = logging.getLogger(__name__)

_BLACKSKY_ISSUER = "https://blacksky.app"


def normalize_token_scope(issuer: str, scope: str) -> str:
    """Canonicalize Blacksky's empty positional repo scope."""
    if issuer.rstrip("/") != _BLACKSKY_ISSUER:
        return scope
    return " ".join(
        token.replace("repo:?", "repo?", 1) if token.startswith("repo:?") else token
        for token in scope.split()
    )


class BlackskyCompatibleOAuthClient(OAuthClient):
    """Accept Blacksky's non-canonical ``repo:?`` scope serialization."""

    async def _exchange_code_for_tokens(
        self,
        code: str,
        oauth_state: OAuthState,
    ) -> tuple[TokenResponse, str]:
        token_response, dpop_nonce = await super()._exchange_code_for_tokens(
            code,
            oauth_state,
        )
        normalized_scope = normalize_token_scope(
            oauth_state.authserver_iss,
            token_response.scope,
        )
        if normalized_scope != token_response.scope:
            logger.warning("normalized non-canonical Blacksky OAuth repo scope")
            token_response.scope = normalized_scope
        return token_response, dpop_nonce
