"""space URI helpers.

today's scheme is ``plyr-space://<owner_did>/<type>/<skey>`` — a one-line
swap to ``ats://`` when atproto permissioned data ships. picked a distinct
scheme rather than ``at://`` because the spec is explicit that permissioned
URIs resolve through a different protocol from public records.
"""

from urllib.parse import urlparse

SCHEME = "plyr-space"


def build_space_uri(owner_did: str, type_nsid: str, skey: str) -> str:
    """build a space URI from its components."""
    return f"{SCHEME}://{owner_did}/{type_nsid}/{skey}"


def parse_space_uri(uri: str) -> tuple[str, str, str]:
    """parse a space URI into ``(owner_did, type_nsid, skey)``.

    raises ``ValueError`` if the URI does not match the expected scheme.
    """
    parsed = urlparse(uri)
    if parsed.scheme != SCHEME:
        raise ValueError(f"expected {SCHEME}:// URI, got {uri!r}")
    owner_did = parsed.netloc
    parts = parsed.path.lstrip("/").split("/", 1)
    if len(parts) != 2 or not all(parts):
        raise ValueError(f"malformed space URI: {uri!r}")
    type_nsid, skey = parts
    return owner_did, type_nsid, skey
