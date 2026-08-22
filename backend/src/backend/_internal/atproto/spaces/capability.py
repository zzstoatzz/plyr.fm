"""whether a session can use permissioned spaces (private media).

One question, answered by the thing that knows: the granted token. A
spaces-capable PDS expands ``include:<ns>.privateMediaAccess`` into
``space:`` grants at consent; any other PDS leaves it unexpanded. Authorization
server metadata cannot carry this — the reference provider lists only
``atproto`` and the ``transition:*`` hints ("other atproto scopes can't be
enumerated as they are dynamic"), and every implementation now matches it.
"""

from backend._internal.auth.session import Session as AuthSession
from backend._internal.auth.space_scope import private_media_grant_present


def session_has_private_media_access(auth_session: AuthSession) -> bool:
    """whether this session may write to the user's private-media space."""
    data = auth_session.oauth_session or {}
    if data.get("auth_type") == "app_password":
        return True
    return private_media_grant_present(data.get("scope", ""), auth_session.did)
