"""backward compatibility - re-exports from fm_teal package.

DEPRECATED: import from backend._internal.atproto.records.fm_teal instead.
"""

from backend._internal.atproto.records.fm_teal import (
    create_teal_play_record,
    update_teal_status,
)
from backend._internal.atproto.records.fm_teal.play import build_teal_play_record
from backend._internal.atproto.records.fm_teal.status import build_teal_status_record

__all__ = [
    "build_teal_play_record",
    "build_teal_status_record",
    "create_teal_play_record",
    "update_teal_status",
]
