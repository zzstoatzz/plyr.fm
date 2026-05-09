"""permissioned-data spaces — backend implementation aligned to atproto spec.

see https://github.com/zzstoatzz/plyr.fm/issues/1384 for strategy and
https://github.com/bluesky-social/atproto/compare/permissioned-data for the
upstream reference implementation we're tracking.
"""

from backend._internal.spaces.nsids import (
    PERSONAL_SPACE_TYPE,
    PLAYLIST_COLLECTION,
)
from backend._internal.spaces.ops import (
    add_member,
    can_read,
    create_record,
    delete_record,
    get_or_create_personal_space,
    get_record,
    is_member,
    list_records,
    update_record,
)
from backend._internal.spaces.uri import build_space_uri, parse_space_uri

__all__ = [
    "PERSONAL_SPACE_TYPE",
    "PLAYLIST_COLLECTION",
    "add_member",
    "build_space_uri",
    "can_read",
    "create_record",
    "delete_record",
    "get_or_create_personal_space",
    "get_record",
    "is_member",
    "list_records",
    "parse_space_uri",
    "update_record",
]
