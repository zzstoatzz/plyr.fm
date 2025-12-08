"""ATProto integration for relay."""

from backend._internal.atproto.profile import (
    fetch_user_avatar,
    fetch_user_profile,
    normalize_avatar_url,
)
from backend._internal.atproto.records import (
    create_comment_record,
    create_like_record,
    create_list_record,
    create_track_record,
    delete_record_by_uri,
    sync_atproto_records,
    update_comment_record,
    update_list_record,
    upsert_album_list_record,
    upsert_liked_list_record,
    upsert_profile_record,
)

__all__ = [
    "create_comment_record",
    "create_like_record",
    "create_list_record",
    "create_track_record",
    "delete_record_by_uri",
    "fetch_user_avatar",
    "fetch_user_profile",
    "normalize_avatar_url",
    "sync_atproto_records",
    "update_comment_record",
    "update_list_record",
    "upsert_album_list_record",
    "upsert_liked_list_record",
    "upsert_profile_record",
]
