"""plyr's plugin for the Osprey worker: input, UDFs and output, all from env.

DATABASE_URL             next's Postgres (the writer login)
TRACK_COLLECTION_NSID    default fm.plyr.track
LIST_COLLECTION_NSID     default fm.plyr.list (albums and playlists, for their covers)
AUDD_API_TOKEN           for fingerprinting; unset, tracks wait unscanned and only covers run
ANTHROPIC_API_KEY        for the cover check
OSPREY_DRAIN_ONCE        true: stop when caught up (a scheduled run)
OSPREY_POLL_SECONDS      otherwise, how long to wait when caught up
OSPREY_START_AT_US       where the tracks walk's first run starts; default now
OSPREY_COVERS_START_AT_US  where the covers walk's first run starts; default now
"""

import logging
from collections.abc import Sequence
from functools import cache
from typing import Any

import anthropic
from osprey.engine.executor.execution_context import Action
from osprey.engine.udf.base import UDFBase
from osprey.worker.adaptor.plugin_manager import hookimpl_osprey
from osprey.worker.lib.config import Config
from osprey.worker.lib.storage.labels import LabelsServiceBase
from osprey.worker.sinks.sink.input_stream import BaseInputStream
from osprey.worker.sinks.sink.output_sink import BaseOutputSink
from osprey.worker.sinks.utils.acking_contexts import BaseAckingContext

from plyr_osprey import udfs
from plyr_osprey.entity_labels import PostgresEntityLabels
from plyr_osprey.fingerprint import AudDFingerprinter
from plyr_osprey.image_scan import ClaudeImageScanner
from plyr_osprey.store import IndexedCover, Store
from plyr_osprey.tracks import CURSORS, ModerationLogSink, TrackInputStream, Walk

log = logging.getLogger(__name__)


@cache
def _shared(config: Config) -> tuple[Store, Walk]:
    store = Store(
        config.expect_str('DATABASE_URL'),
        config.get_str('TRACK_COLLECTION_NSID', 'fm.plyr.track'),
        config.get_str('LIST_COLLECTION_NSID', 'fm.plyr.list'),
    )
    return store, Walk()


@hookimpl_osprey
def register_udfs() -> Sequence[type[UDFBase[Any, Any]]]:
    return [udfs.UrlHost, udfs.RecordingsPlayingThrough, udfs.ImagePolicyViolations, udfs.FlagForReview]


@hookimpl_osprey
def register_input_stream(config: Config) -> BaseInputStream[BaseAckingContext[Action]]:
    # without a token every track scan would fail and, after a few runs, be
    # passed over for good; leave the tracks walk where it is instead, so they
    # are all scanned once the token is set
    audd_token = config.get_optional_str('AUDD_API_TOKEN')
    if audd_token:
        udfs.fingerprinter = AudDFingerprinter(audd_token)
        cursors = CURSORS
    else:
        log.warning('AUDD_API_TOKEN is not set: tracks wait unscanned, covers are still checked')
        cursors = (IndexedCover.cursor,)
    udfs.image_scanner = ClaudeImageScanner(anthropic.Anthropic(api_key=config.expect_str('ANTHROPIC_API_KEY')))
    store, walk = _shared(config)
    start = config.get_optional_str('OSPREY_START_AT_US')
    covers_start = config.get_optional_str('OSPREY_COVERS_START_AT_US')
    return TrackInputStream(
        store,
        walk,
        poll_seconds=float(config.get_int('OSPREY_POLL_SECONDS', 30)),
        drain_once=config.get_bool('OSPREY_DRAIN_ONCE', False),
        start_at_us=int(start) if start else None,
        covers_start_at_us=int(covers_start) if covers_start else None,
        cursors=cursors,
    )


@hookimpl_osprey
def register_output_sinks(config: Config) -> Sequence[BaseOutputSink]:
    store, walk = _shared(config)
    return [ModerationLogSink(store, walk)]


@hookimpl_osprey
def register_labels_service_or_provider(config: Config) -> LabelsServiceBase:
    return PostgresEntityLabels(config.expect_str('DATABASE_URL'))
