"""ch.indiemusi.alpha lexicon record writers.

writers only — plyr.fm publishes copyright metadata to the user's PDS under the
indiemusi paradigm but does not consume the indiemusi firehose for these records.
"""

from backend._internal.atproto.records.ch_indiemusi.actor_publishing_owner import (
    build_publishing_owner_record,
    create_publishing_owner_record,
)
from backend._internal.atproto.records.ch_indiemusi.models import (
    IPI_PATTERN,
    ISRC_PATTERN,
    ISWC_PATTERN,
    InterestedPartyInput,
    MasterOwnerInput,
    PublishingOwnerInput,
    RecordingArtistInput,
    RecordingInput,
    SongInput,
)
from backend._internal.atproto.records.ch_indiemusi.recording import (
    build_recording_record,
    create_recording_record,
    update_recording_record,
)
from backend._internal.atproto.records.ch_indiemusi.song import (
    build_song_record,
    create_song_record,
    update_song_record,
)

__all__ = [
    "IPI_PATTERN",
    "ISRC_PATTERN",
    "ISWC_PATTERN",
    "InterestedPartyInput",
    "MasterOwnerInput",
    "PublishingOwnerInput",
    "RecordingArtistInput",
    "RecordingInput",
    "SongInput",
    "build_publishing_owner_record",
    "build_recording_record",
    "build_song_record",
    "create_publishing_owner_record",
    "create_recording_record",
    "create_song_record",
    "update_recording_record",
    "update_song_record",
]
