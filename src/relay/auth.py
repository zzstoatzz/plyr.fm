"""authentication and session management."""

import secrets
from dataclasses import dataclass
from typing import Annotated

from atproto import Client, IdResolver
from fastapi import Cookie, HTTPException


@dataclass
class Session:
    """authenticated user session."""

    session_id: str
    did: str
    handle: str


# in-memory session store (MVP - replace with redis/db later)
_sessions: dict[str, Session] = {}


def create_session(did: str, handle: str) -> str:
    """create a new session for authenticated user."""
    session_id = secrets.token_urlsafe(32)
    _sessions[session_id] = Session(session_id=session_id, did=did, handle=handle)
    return session_id


def get_session(session_id: str) -> Session | None:
    """retrieve session by id."""
    return _sessions.get(session_id)


def delete_session(session_id: str) -> None:
    """delete a session."""
    _sessions.pop(session_id, None)


def verify_app_password(handle: str, app_password: str) -> tuple[str, str]:
    """verify atproto app password and return (did, handle)."""
    try:
        # resolve handle to DID, then get DID document to find PDS
        resolver = IdResolver()

        # first resolve handle to DID
        did = resolver.handle.resolve(handle)

        # then get DID document
        did_doc = resolver.did.resolve(did)

        # find PDS service endpoint from DID document
        pds_url = None
        if hasattr(did_doc, "service") and did_doc.service:
            for service in did_doc.service:
                if service.id == "#atproto_pds":
                    pds_url = service.service_endpoint
                    break

        if not pds_url:
            raise ValueError("no PDS service found for this handle")

        # create client with user's actual PDS
        client = Client(base_url=pds_url)
        profile = client.login(handle, app_password)
        return profile.did, profile.handle
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"authentication failed: {e}",
        ) from e


def require_auth(
    session_id: Annotated[str | None, Cookie()] = None,
) -> Session:
    """fastapi dependency to require authentication."""
    if not session_id:
        raise HTTPException(
            status_code=401,
            detail="not authenticated - login required",
        )

    session = get_session(session_id)
    if not session:
        raise HTTPException(
            status_code=401,
            detail="invalid or expired session",
        )

    return session
