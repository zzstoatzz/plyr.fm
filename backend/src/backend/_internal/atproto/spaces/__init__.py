"""permissioned-data spaces (com.atproto.space.*).

experimental ATProto permissioned-data surface. all of this engages only for
sessions whose PDS granted the private-media space scope at login — see
[capability.session_has_permissioned_scope][backend._internal.atproto.spaces.capability.session_has_permissioned_scope].
"""

from backend._internal.atproto.spaces.capability import (
    session_has_permissioned_scope,
)
from backend._internal.atproto.spaces.uris import (
    build_record_uri,
    build_space_uri,
    parse_space_uri,
)

__all__ = [
    "build_record_uri",
    "build_space_uri",
    "parse_space_uri",
    "session_has_permissioned_scope",
]
