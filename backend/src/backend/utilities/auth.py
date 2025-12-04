"""authentication utilities."""

from fastapi import Request


def get_session_id_from_request(
    request: Request, session_id_cookie: str | None = None
) -> str | None:
    """extract session ID from cookie or authorization header.

    checks cookie first (browser requests), then falls back to bearer token
    in authorization header (SDK/CLI clients).
    """
    if session_id_cookie:
        return session_id_cookie

    if authorization := request.headers.get("authorization"):
        return authorization.removeprefix("Bearer ")

    return None
