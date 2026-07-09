"""permissioned-data spaces (com.atproto.space.*).

experimental ATProto permissioned-data surface. all of this engages only for
sessions whose PDS actually implements the space methods — see
[capability.detect_permissioned_capability][backend._internal.atproto.spaces.capability.detect_permissioned_capability].
"""

from backend._internal.atproto.spaces.capability import (
    detect_permissioned_capability,
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
    "detect_permissioned_capability",
    "parse_space_record_uri",
    "parse_space_uri",
]
