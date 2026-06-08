"""whether a session may access private (permissioned-space) media.

private media lives in the artist's `com.atproto.space.*` repo on their PDS. a
PDS exposes that surface to plyr ONLY if it can grant the private-media
permission set during OAuth — so capability is simply "the granted token carries
the space scope." we request that scope at login (falling back when the PDS
rejects it with `invalid_scope`), which makes the granted scope itself the
capability signal.

deliberately NOT a runtime probe: an authenticated `com.atproto.space.listSpaces`
call needs the very space scope we're trying to detect (a valid-but-unscoped
token gets `403 InsufficientScope`), and a scopeless probe only ever surfaces a
`401` that's indistinguishable from an expired token — which made the old probe
both a deadlock and a source of pointless token-refresh churn.
"""

from backend._internal import Session as AuthSession
from backend.config import settings


def session_has_permissioned_scope(auth_session: AuthSession) -> bool:
    """whether the session's granted OAuth scope includes private-media space access.

    matches the private-media NSID, which is present whether the scope is the
    requested `include:<nsid>` form or the granted, expanded `space:<nsid>?...` form.
    """
    scope = (auth_session.oauth_session or {}).get("scope", "")
    return settings.atproto.private_media_space_type in scope
