"""the worker's input stream and output sink, which share one walk over the catalog.

the stream yields each indexed track as a `track` action; the sink records
what the rules made of it and moves the cursor. they run one action at a time
(`run-rules-sink --no-pooled`), so the stream can hold back the next track
until the sink has settled the last one, and stop if it failed.
"""

import logging
import time
from collections.abc import Iterator
from datetime import UTC, datetime

from osprey.engine.executor.execution_context import Action, ExecutionResult
from osprey.worker.sinks.sink.input_stream import BaseInputStream
from osprey.worker.sinks.sink.output_sink import BaseOutputSink
from osprey.worker.sinks.utils.acking_contexts import BaseAckingContext, NoopAckingContext

from plyr_osprey.store import Flag, IndexedTrack, Store
from plyr_osprey.udfs import FlagEffect

log = logging.getLogger('plyr_osprey')

ACTION_NAME = 'track'
RECORDINGS_FEATURE = 'Recordings'


class Walk:
    """the track in flight between the stream and the sink."""

    def __init__(self) -> None:
        self.current: IndexedTrack | None = None
        self.settled = True
        self.stop = False


class TrackInputStream(BaseInputStream[BaseAckingContext[Action]]):
    def __init__(
        self,
        store: Store,
        walk: Walk,
        *,
        batch_size: int = 25,
        poll_seconds: float = 30.0,
        drain_once: bool = False,
        start_at_us: int | None = None,
    ) -> None:
        super().__init__()
        self._store = store
        self._walk = walk
        self._batch_size = batch_size
        self._poll_seconds = poll_seconds
        self._drain_once = drain_once
        self._start_at_us = start_at_us

    def _gen(self) -> Iterator[BaseAckingContext[Action]]:
        while True:
            position = self._store.cursor_position(self._start_at_us)
            batch = self._store.tracks_after(position, self._batch_size)
            interrupted = False
            for track in batch:
                self._walk.current, self._walk.settled = track, False
                yield NoopAckingContext(_action(track))
                if not self._walk.settled:
                    # the sink never saw it, or failed: the rules or a scan errored
                    passed_over = self._store.failed(track)
                    log.warning('track %s failed%s', track.uri, ', passed over' if passed_over else '')
                    interrupted = True
                    break
            if self._walk.stop:
                return
            if not batch or interrupted:
                if self._drain_once:
                    return
                time.sleep(self._poll_seconds)


def _action(track: IndexedTrack) -> Action:
    return Action(
        action_id=track.ready_at_us,
        action_name=ACTION_NAME,
        data=track.action_data(),
        timestamp=datetime.fromtimestamp(track.ready_at_us / 1_000_000, tz=UTC),
    )


class ModerationLogSink(BaseOutputSink):
    """writes rule flags to next's moderation log, where they open a review."""

    def __init__(self, store: Store, walk: Walk) -> None:
        self._store = store
        self._walk = walk

    def will_do_work(self, result: ExecutionResult) -> bool:
        return result.action.action_name == ACTION_NAME

    def push(self, result: ExecutionResult) -> None:
        track = self._walk.current
        if track is None or result.action.data.get('uri') != track.uri:
            return
        if result.error_infos:
            for error in result.error_infos:
                log.warning('rules error on %s: %s', track.uri, error.error)
            return
        flags = [
            Flag(subject=e.subject, action=e.action, actor=e.actor, reason=e.reason)
            for e in result.effects.get(FlagEffect, [])
            if isinstance(e, FlagEffect)
        ]
        recordings = result.extracted_features.get(RECORDINGS_FEATURE)
        self._store.finish(track, flags, recordings if isinstance(recordings, list) else None)
        self._walk.settled = True
        if isinstance(recordings, list):
            log.info('scanned %s (%s): %d recordings', track.uri, track.audio_url, len(recordings))
        if flags:
            log.info('flagged %s: %s', track.uri, ', '.join(f.actor for f in flags))

    def stop(self) -> None:
        self._walk.stop = True
        self._store.close()
