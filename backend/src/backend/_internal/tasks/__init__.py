"""background task functions for docket.

these functions are registered with docket and executed by workers.
they should be self-contained and handle their own database sessions.

requires DOCKET_URL to be set (Redis is always available).
"""

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
from backend._internal.tasks.hooks import (
    invalidate_tracks_discovery_cache,
    run_post_track_create_hooks,
)
from backend._internal.tasks.ingest import (
    SubjectNotFoundError,
    ingest_comment_create,
    ingest_comment_delete,
    ingest_comment_update,
    ingest_like_create,
    ingest_like_delete,
    ingest_list_create,
    ingest_list_delete,
    ingest_list_update,
    ingest_profile_update,
    ingest_track_create,
    ingest_track_delete,
    ingest_track_update,
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
    schedule_follow_graph_warm,
    schedule_teal_scrobble,
    scrobble_to_teal,
    sync_album_list,
    sync_atproto,
    warm_follow_graph,
)


def _build_background_tasks() -> list:
    """build the task list, deferring heavy imports to reduce startup memory.

    deferred: jetstream (circular dep), export_tasks (pulls in boto3/botocore)
    """
    from backend._internal.export_tasks import process_export
    from backend._internal.jetstream import consume_jetstream

    return [
        consume_jetstream,
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
        warm_follow_graph,
        ingest_track_create,
        ingest_track_update,
        ingest_track_delete,
        ingest_like_create,
        ingest_like_delete,
        ingest_comment_create,
        ingest_comment_update,
        ingest_comment_delete,
        ingest_list_create,
        ingest_list_update,
        ingest_list_delete,
        ingest_profile_update,
    ]


# lazily constructed on first access (docket worker startup)
_background_tasks: list | None = None


def __getattr__(name: str):
    if name == "background_tasks":
        global _background_tasks
        if _background_tasks is None:
            _background_tasks = _build_background_tasks()
        return _background_tasks
    if name == "consume_jetstream":
        from backend._internal.jetstream import consume_jetstream

        return consume_jetstream
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "SubjectNotFoundError",
    "background_tasks",
    "classify_genres",
    "consume_jetstream",
    "generate_embedding",
    "ingest_comment_create",
    "ingest_comment_delete",
    "ingest_comment_update",
    "ingest_like_create",
    "ingest_like_delete",
    "ingest_list_create",
    "ingest_list_delete",
    "ingest_list_update",
    "ingest_profile_update",
    "ingest_track_create",
    "ingest_track_delete",
    "ingest_track_update",
    "invalidate_tracks_discovery_cache",
    "move_track_audio",
    "pds_create_comment",
    "pds_create_like",
    "pds_delete_comment",
    "pds_delete_like",
    "pds_update_comment",
    "run_post_track_create_hooks",
    "scan_copyright",
    "schedule_album_list_sync",
    "schedule_atproto_sync",
    "schedule_copyright_resolution_sync",
    "schedule_copyright_scan",
    "schedule_embedding_generation",
    "schedule_follow_graph_warm",
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
    "warm_follow_graph",
]
