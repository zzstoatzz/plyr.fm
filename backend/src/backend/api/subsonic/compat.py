"""navidrome-native compatibility (outside /rest).

navidrome-first clients (Shelv) save a server by calling navidrome's native
`POST /auth/login` and decoding the returned user `id` — subsonic ping alone
isn't enough for them. this validates the developer token and answers with
the account DID as the stable user id. no session or cookie is issued; every
subsequent request re-authenticates through the subsonic params like any
other subsonic client.
"""

from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from backend.api.subsonic.auth import authenticate
from backend.api.subsonic.responses import SubsonicError

router = APIRouter(tags=["subsonic"])


class NavidromeLoginRequest(BaseModel):
    """navidrome native login body."""

    username: str
    password: str


@router.post("/auth/login", include_in_schema=False)
async def navidrome_login(body: NavidromeLoginRequest) -> ORJSONResponse:
    try:
        session = await authenticate({"u": body.username, "p": body.password})
    except SubsonicError:
        return ORJSONResponse({"error": "invalid credentials"}, status_code=401)
    return ORJSONResponse(
        {
            "id": session.did,
            "username": session.handle,
            "name": session.handle,
            "isAdmin": False,
        }
    )
