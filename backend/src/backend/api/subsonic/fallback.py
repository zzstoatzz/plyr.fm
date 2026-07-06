"""catch-all for unimplemented subsonic methods.

per protocol, unknown methods should come back as a failed envelope with
HTTP 200 — a raw 404 reads as "server broken" to clients and surfaces scary
error banners for optional features. registered last so every real endpoint
wins route matching.
"""

from fastapi import Request, Response

from backend.api.subsonic.endpoints import _request_params
from backend.api.subsonic.responses import ERROR_GENERIC, SubsonicError, error_response
from backend.api.subsonic.router import router


@router.api_route("/{method}", methods=["GET", "POST"], include_in_schema=False)
async def unimplemented(method: str, request: Request) -> Response:
    params = await _request_params(request)
    name = method.removesuffix(".view")
    return error_response(
        params, SubsonicError(ERROR_GENERIC, f"{name} is not implemented")
    )
