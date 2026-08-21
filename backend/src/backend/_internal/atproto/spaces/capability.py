"""whether a session can use permissioned spaces (private media).

No PDS advertises the space surface declaratively, and probing a
``com.atproto.space.*`` route is a guess about the host. The honest signal is
the token: a spaces-capable PDS expands ``include:<permission set>`` into
concrete ``space:`` grants, and one that is not either rejects the scope or
returns a token without them. Capability is therefore read from the granted
scope, and a grant that came back empty is remembered per (account, PDS) so
the option is not offered again until the user retries explicitly.
"""

from sqlalchemy import select

from backend._internal.auth.session import Session as AuthSession
from backend._internal.auth.space_scope import (
    permissioned_scope_requested,
    private_media_grant_present,
)
from backend.models import Artist
from backend.utilities.database import db_session

__all__ = [
    "permissioned_scope_requested",
    "private_media_grant_present",
    "session_has_private_media_access",
    "set_spaces_unsupported",
    "spaces_unsupported_here",
]


def session_has_private_media_access(auth_session: AuthSession) -> bool:
    """whether this session may write to the user's private-media space."""
    data = auth_session.oauth_session or {}
    if data.get("auth_type") == "app_password":
        return True
    return private_media_grant_present(data.get("scope", ""), auth_session.did)


def spaces_unsupported_here(artist: Artist | None, auth_session: AuthSession) -> bool:
    """whether a previous upgrade on this session's PDS came back without the grant."""
    pds_url = (auth_session.oauth_session or {}).get("pds_url")
    return bool(artist and pds_url and artist.spaces_unsupported_pds == pds_url)


async def set_spaces_unsupported(did: str, pds_url: str | None) -> None:
    """record (or, with ``None``, clear) the PDS that returned no private-media grant."""
    async with db_session() as db:
        result = await db.execute(select(Artist).where(Artist.did == did))
        if artist := result.scalar_one_or_none():
            artist.spaces_unsupported_pds = pds_url
            await db.commit()
