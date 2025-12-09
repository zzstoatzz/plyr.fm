"""fm.teal.* lexicon record types (scrobbling integration)."""

from backend._internal.atproto.records.fm_teal.play import create_teal_play_record
from backend._internal.atproto.records.fm_teal.status import update_teal_status

__all__ = [
    "create_teal_play_record",
    "update_teal_status",
]
