"""subsonic-response envelope serialization.

subsonic clients negotiate the wire format via the `f` query param: xml is
the protocol default, `f=json` wraps the same shape in `{"subsonic-response":
{...}}`, and `f=jsonp` adds a `callback(...)` wrapper. protocol errors travel
inside a `status="failed"` envelope with HTTP 200, not as HTTP error codes.
"""

import xml.etree.ElementTree as ET
from collections.abc import Mapping
from importlib.metadata import PackageNotFoundError, version
from typing import Any

import orjson
from fastapi import Response

SUBSONIC_API_VERSION = "1.16.1"
_XMLNS = "http://subsonic.org/restapi"

try:
    _SERVER_VERSION = version("backend")
except PackageNotFoundError:
    _SERVER_VERSION = "0"

# subsonic protocol error codes
ERROR_GENERIC = 0
ERROR_MISSING_PARAMETER = 10
ERROR_WRONG_CREDENTIALS = 40
ERROR_NOT_AUTHORIZED = 50
ERROR_NOT_FOUND = 70


class SubsonicError(Exception):
    """carries a subsonic protocol error code to the error envelope."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _prune(value: Any) -> Any:
    """drop None values recursively so they never hit the wire."""
    if isinstance(value, dict):
        return {k: _prune(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [_prune(item) for item in value]
    return value


def _element(name: str, data: dict[str, Any]) -> ET.Element:
    """map a payload dict onto subsonic xml: scalars become attributes,
    dicts become child elements, lists become repeated child elements."""
    element = ET.Element(name)
    for key, value in data.items():
        if isinstance(value, dict):
            element.append(_element(key, value))
        elif isinstance(value, list):
            for item in value:
                element.append(_element(key, item))
        elif isinstance(value, bool):
            element.set(key, "true" if value else "false")
        else:
            element.set(key, str(value))
    return element


def subsonic_response(
    params: Mapping[str, str], payload: dict[str, Any], *, status: str = "ok"
) -> Response:
    """wrap a payload in the subsonic-response envelope, honoring `f`."""
    # serverVersion + openSubsonic: OpenSubsonic-era clients (Shelv, Feishin)
    # decode these as required envelope fields and fail without them
    body = _prune(
        {
            "status": status,
            "version": SUBSONIC_API_VERSION,
            "type": "plyr.fm",
            "serverVersion": _SERVER_VERSION,
            "openSubsonic": True,
            **payload,
        }
    )
    response_format = params.get("f", "xml")
    if response_format in ("json", "jsonp"):
        document = orjson.dumps({"subsonic-response": body}).decode()
        if response_format == "jsonp" and (callback := params.get("callback")):
            return Response(
                f"{callback}({document});", media_type="application/javascript"
            )
        return Response(document, media_type="application/json")
    root = _element("subsonic-response", {"xmlns": _XMLNS, **body})
    document = ET.tostring(root, encoding="unicode")
    return Response(
        f'<?xml version="1.0" encoding="UTF-8"?>\n{document}',
        media_type="text/xml",
    )


def error_response(params: Mapping[str, str], error: SubsonicError) -> Response:
    """render a SubsonicError as a failed envelope (HTTP 200, per protocol)."""
    return subsonic_response(
        params,
        {"error": {"code": error.code, "message": error.message}},
        status="failed",
    )
