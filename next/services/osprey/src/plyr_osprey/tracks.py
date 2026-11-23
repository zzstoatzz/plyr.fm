"""the worker's input stream and output sink, which share the walks over the catalog.

the stream yields each indexed track as a `track` action and each cover (a
track's or an album/playlist's) as a `cover` action, one walk after the other;
the sink records what the rules made of it and moves that walk's cursor. they run one action at a time
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

from plyr_osprey.store import Flag, Indexed, IndexedCover, IndexedTrack, Store
from plyr_osprey.udfs import FlagEffect

log = logging.getLogger('plyr_osprey')

ACTION_NAMES = (IndexedTrack.action_name, IndexedCover.action_name)
CURSORS = (IndexedTrack.cursor, IndexedCover.cursor)
# what a scan found, as the rules extract it: a scan that ran leaves a list
SCAN_FEATURES = {IndexedTrack.action_name: 'Recordings', IndexedCover.action_name: 'CoverViolations'}


class Walk:
    """the record in flight between the stream and the sink."""

    def __init__(self) -> None:
        self.current: Indexed | None = None
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
        covers_start_at_us: int | None = None,
        cursors: tuple[str, ...] = CURSORS,
    ) -> None:
        super().__init__()
        self._store = store
        self._walk = walk
        self._batch_size = batch_size
        self._poll_seconds = poll_seconds
        self._drain_once = drain_once
        self._starts = {IndexedTrack.cursor: start_at_us, IndexedCover.cursor: covers_start_at_us}
        self._cursors = cursors

    def _gen(self) -> Iterator[BaseAckingContext[Action]]:
        drained: set[str] = set()
        while True:
            idle = True
            for cursor in self._cursors:
                if cursor in drained:
                    continue
                position = self._store.cursor_position(cursor, self._starts[cursor])
                batch = self._store.after(cursor, position, self._batch_size)
                interrupted = False
                for item in batch:
                    self._walk.current, self._walk.settled = item, False
                    yield NoopAckingContext(_action(item))
                    if not self._walk.settled:
                        # the sink never saw it, or failed: the rules or a scan errored
                        passed_over = self._store.failed(item)
                        log.warning(
                            '%s %s failed%s', item.action_name, item.uri, ', passed over' if passed_over else ''
                        )
                        interrupted = True
                        break
                if self._walk.stop:
                    return
                if batch and not interrupted:
                    idle = False
                elif self._drain_once:
                    drained.add(cursor)
            if self._drain_once and len(drained) == len(self._cursors):
                return
            if idle:
                time.sleep(self._poll_seconds)


def _action(item: Indexed) -> Action:
    return Action(
        action_id=item.ready_at_us,
        action_name=item.action_name,
        data=item.action_data(),
        timestamp=datetime.fromtimestamp(item.ready_at_us / 1_000_000, tz=UTC),
    )


class ModerationLogSink(BaseOutputSink):
    """writes rule flags to next's moderation log, where they open a review."""

    def __init__(self, store: Store, walk: Walk) -> None:
        self._store = store
        self._walk = walk

    def will_do_work(self, result: ExecutionResult) -> bool:
        return result.action.action_name in ACTION_NAMES

    def push(self, result: ExecutionResult) -> None:
        item = self._walk.current
        if item is None or result.action.action_name != item.action_name or result.action.data.get('uri') != item.uri:
            return
        if result.error_infos:
            for error in result.error_infos:
                log.warning('rules error on %s %s: %s', item.action_name, item.uri, error.error)
            return
        flags = [
            Flag(subject=e.subject, action=e.action, actor=e.actor, reason=e.reason)
            for e in result.effects.get(FlagEffect, [])
            if isinstance(e, FlagEffect)
        ]
        found = result.extracted_features.get(SCAN_FEATURES[item.action_name])
        self._store.finish(item, flags, found if isinstance(found, list) else None)
        self._walk.settled = True
        if isinstance(found, list):
            scanned = item.audio_url if isinstance(item, IndexedTrack) else item.cover_url
            log.info('scanned %s %s (%s): %d found', item.action_name, item.uri, scanned, len(found))
        if flags:
            log.info('flagged %s: %s', item.uri, ', '.join(f.actor for f in flags))

    def stop(self) -> None:
        self._walk.stop = True
        self._store.close()
