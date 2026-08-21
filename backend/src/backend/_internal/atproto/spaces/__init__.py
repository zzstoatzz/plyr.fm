"""permissioned-data spaces (com.atproto.space.*).

experimental ATProto permissioned-data surface. whether a session can use it is
read from the token's expanded ``space:`` grant — see
[capability][backend._internal.atproto.spaces.capability].
"""

from backend._internal.atproto.spaces.capability import (
    permissioned_scope_requested,
    private_media_grant_present,
    session_has_private_media_access,
    set_spaces_unsupported,
    spaces_unsupported_here,
)
from backend._internal.atproto.spaces.uris import (
    build_record_uri,
    build_space_uri,
    parse_space_record_uri,
    parse_space_uri,
)

__all__ = [
    "build_record_uri",
    "build_space_uri",
    "parse_space_record_uri",
    "parse_space_uri",
    "permissioned_scope_requested",
    "private_media_grant_present",
    "session_has_private_media_access",
    "set_spaces_unsupported",
    "spaces_unsupported_here",
]
