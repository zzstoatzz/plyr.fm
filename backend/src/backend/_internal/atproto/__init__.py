"""ATProto integration for relay."""

from backend._internal.atproto.profile import (
    fetch_user_avatar,
    fetch_user_profile,
    normalize_avatar_url,
)
from backend._internal.atproto.records import (
    create_comment_record,
    create_like_record,
    create_track_record,
    delete_record_by_uri,
    update_comment_record,
)

__all__ = [
    "create_comment_record",
    "create_like_record",
    "create_track_record",
    "delete_record_by_uri",
    "fetch_user_avatar",
    "fetch_user_profile",
    "normalize_avatar_url",
    "update_comment_record",
]
