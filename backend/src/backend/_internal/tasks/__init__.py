"""background task functions for docket.

these functions are registered with docket and executed by workers.
they should be self-contained and handle their own database sessions.

requires DOCKET_URL to be set (Redis is always available).
"""

from backend._internal.export_tasks import process_export
from backend._internal.pds_backfill_tasks import backfill_tracks_to_pds
from backend._internal.tasks.copyright import (
    scan_copyright,
    schedule_copyright_resolution_sync,
    schedule_copyright_scan,
    sync_copyright_resolutions,
)
from backend._internal.tasks.ml import (
    classify_genres,
    generate_embedding,
    schedule_embedding_generation,
    schedule_genre_classification,
)
from backend._internal.tasks.pds import (
    pds_create_comment,
    pds_create_like,
    pds_delete_comment,
    pds_delete_like,
    pds_update_comment,
    schedule_pds_create_comment,
    schedule_pds_create_like,
    schedule_pds_delete_comment,
    schedule_pds_delete_like,
    schedule_pds_update_comment,
)
from backend._internal.tasks.storage import (
    move_track_audio,
    schedule_move_track_audio,
)
from backend._internal.tasks.sync import (
    schedule_album_list_sync,
    schedule_atproto_sync,
    schedule_teal_scrobble,
    scrobble_to_teal,
    sync_album_list,
    sync_atproto,
)

# collection of all background task functions for docket registration
background_tasks = [
    scan_copyright,
    sync_copyright_resolutions,
    process_export,
    sync_atproto,
    scrobble_to_teal,
    sync_album_list,
    pds_create_like,
    pds_delete_like,
    pds_create_comment,
    pds_delete_comment,
    pds_update_comment,
    backfill_tracks_to_pds,
    move_track_audio,
    generate_embedding,
    classify_genres,
]

__all__ = [
    "background_tasks",
    "classify_genres",
    "generate_embedding",
    "move_track_audio",
    "pds_create_comment",
    "pds_create_like",
    "pds_delete_comment",
    "pds_delete_like",
    "pds_update_comment",
    "scan_copyright",
    "schedule_album_list_sync",
    "schedule_atproto_sync",
    "schedule_copyright_resolution_sync",
    "schedule_copyright_scan",
    "schedule_embedding_generation",
    "schedule_genre_classification",
    "schedule_move_track_audio",
    "schedule_pds_create_comment",
    "schedule_pds_create_like",
    "schedule_pds_delete_comment",
    "schedule_pds_delete_like",
    "schedule_pds_update_comment",
    "schedule_teal_scrobble",
    "scrobble_to_teal",
    "sync_album_list",
    "sync_atproto",
    "sync_copyright_resolutions",
]
