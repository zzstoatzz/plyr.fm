"""ATProto record types organized by lexicon namespace."""

# re-export commonly used functions for convenience
from backend._internal.atproto.records.fm_plyr import (
    build_track_record,
    create_comment_record,
    create_like_record,
    create_list_record,
    create_track_record,
    delete_record_by_uri,
    get_record_public,
    update_comment_record,
    update_list_record,
    update_record,
    upsert_album_list_record,
    upsert_liked_list_record,
    upsert_profile_record,
)
from backend._internal.atproto.records.fm_teal import (
    create_teal_play_record,
    update_teal_status,
)

# re-export client functions for backward compatibility
# these were previously in records.py and some code imports them from here
from backend._internal.atproto.client import (
    _refresh_session_tokens,
    make_pds_request as _make_pds_request,
    parse_at_uri as _parse_at_uri,
    reconstruct_oauth_session as _reconstruct_oauth_session,
)

__all__ = [
    "_make_pds_request",
    "_parse_at_uri",
    "_reconstruct_oauth_session",
    "_refresh_session_tokens",
    "build_track_record",
    "create_comment_record",
    "create_like_record",
    "create_list_record",
    "create_teal_play_record",
    "create_track_record",
    "delete_record_by_uri",
    "get_record_public",
    "update_comment_record",
    "update_list_record",
    "update_record",
    "update_teal_status",
    "upsert_album_list_record",
    "upsert_liked_list_record",
    "upsert_profile_record",
]
