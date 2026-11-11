import GripHorizontal from 'lucide-react-native/icons/grip-horizontal';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { PanResponder, Platform, StyleSheet, useWindowDimensions, View, type ScrollViewInstance, type KeyDownEvent, type ViewInstance } from 'react-native';
import type { Track } from './api';
import { useAppearance } from './appearance';

interface ScrollMetrics { offset: number; height: number; contentHeight: number }
interface Row { top: number; height: number }
interface Drag {
  queue: Track[]; start: number; from: number; to: number;
  initialY: number; pointerY: number; initialScroll: number; offset: number;
  top: number; bottom: number; rows: Row[];
}

export function QueueReorder({ queue, start, move, renderTrack, scrollRef, scrollMetrics, onDragging }: {
  queue: Track[]; start: number; move(from: number, to: number): void;
  renderTrack(track: Track, index: number): ReactNode;
  scrollRef: RefObject<ScrollViewInstance | null>; scrollMetrics: RefObject<ScrollMetrics>;
  onDragging(value: boolean): void;
}) {
  const theme = useAppearance();
  const { width, height } = useWindowDimensions();
  const layouts = useRef(new Map<number, Row>());
  const active = useRef<Drag | null>(null);
  const pickup = useRef(0);
  const handles = useRef(new Map<number, ViewInstance>());
  const focusTarget = useRef<number | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const latest = useRef({ queue, start, move, onDragging });
  latest.current = { queue, start, move, onDragging };
  const [drag, setDrag] = useState<Drag | null>(null);

  function cancel() {
    pickup.current++;
    active.current = null;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    setDrag(null);
    latest.current.onDragging(false);
  }

  useEffect(() => {
    if (active.current && (active.current.queue !== queue || active.current.start !== start)) cancel();
    if (focusTarget.current !== null) {
      handles.current.get(focusTarget.current)?.focus();
      focusTarget.current = null;
    }
  }, [queue, start]);
  useEffect(() => { if (active.current) cancel(); }, [width, height]);
  useEffect(() => () => {
    pickup.current++;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    if (active.current) { active.current = null; latest.current.onDragging(false); }
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web' || !drag) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    const blur = () => cancel();
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('blur', blur); };
  }, [!!drag]);

  function update(pointerY: number) {
    const current = active.current;
    if (!current) return;
    if (current.queue !== latest.current.queue || current.start !== latest.current.start) { cancel(); return; }
    const rawOffset = pointerY - current.initialY + scrollMetrics.current.offset - current.initialScroll;
    const first = current.rows[0];
    const last = current.rows[current.rows.length - 1];
    const origin = current.rows[current.from];
    const offset = Math.max(first.top - origin.top, Math.min(last.top + last.height - origin.top - origin.height, rawOffset));
    const center = current.rows[current.from].top + current.rows[current.from].height / 2 + offset;
    let to = current.from;
    for (let index = 0; index < current.rows.length; index++) {
      if (index < current.from && center <= current.rows[index].top + current.rows[index].height / 2) { to = index; break; }
      if (index > current.from && center >= current.rows[index].top + current.rows[index].height / 2) to = index;
    }
    active.current = { ...current, pointerY, offset, to };
    setDrag(active.current);
  }

  function autoscroll() {
    const current = active.current;
    if (!current) return;
    const metrics = scrollMetrics.current;
    const edge = 56;
    const velocity = current.pointerY < current.top + edge ? -Math.min(14, (current.top + edge - current.pointerY) / 4)
      : current.pointerY > current.bottom - edge ? Math.min(14, (current.pointerY - current.bottom + edge) / 4) : 0;
    const offset = Math.max(0, Math.min(metrics.contentHeight - metrics.height, metrics.offset + velocity));
    if (velocity && offset !== metrics.offset) {
      metrics.offset = offset;
      scrollRef.current?.scrollTo({ y: offset, animated: false });
      update(current.pointerY);
    }
    frame.current = requestAnimationFrame(autoscroll);
  }

  function begin(index: number, pointerY: number) {
    const rows = queue.slice(start).map((_, offset) => layouts.current.get(offset));
    if (rows.some(row => !row)) return;
    const measured = rows.flatMap(row => row ? [row] : []);
    const request = ++pickup.current;
    scrollRef.current?.measureInWindow((_, top, __, height) => {
      if (request !== pickup.current || latest.current.queue !== queue || latest.current.start !== start) return;
      active.current = { queue, start, from: index, to: index, initialY: pointerY, pointerY,
        initialScroll: scrollMetrics.current.offset, offset: 0, rows: measured, top, bottom: top + height };
      setDrag(active.current);
      latest.current.onDragging(true);
      frame.current = requestAnimationFrame(autoscroll);
    });
  }

  function finish() {
    const current = active.current;
    cancel();
    if (current && current.queue === latest.current.queue && current.start === latest.current.start && current.from !== current.to) {
      latest.current.move(current.start + current.from, current.start + current.to);
    }
  }

  const landing = drag && drag.to !== drag.from ? drag.to > drag.from
    ? drag.rows[drag.to].top + drag.rows[drag.to].height - drag.rows[drag.from].height : drag.rows[drag.to].top : null;
  return <View>
    {landing !== null && <View pointerEvents="none" style={{ position: 'absolute', top: landing, left: 8, right: 8, height: 2, borderRadius: 1, backgroundColor: theme.accent, zIndex: 3 }} />}
    {queue.slice(start).map((track, offset) => {
      const lifted = drag?.from === offset;
      const shift = drag && offset !== drag.from
        ? drag.from < drag.to && offset > drag.from && offset <= drag.to ? -drag.rows[drag.from].height
          : drag.from > drag.to && offset >= drag.to && offset < drag.from ? drag.rows[drag.from].height : 0
        : 0;
      return <View key={`${track.id}:${start + offset}`} onLayout={event => {
        layouts.current.set(offset, { top: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height });
      }} style={[styles.row, {
        zIndex: lifted ? 2 : 0, backgroundColor: lifted ? theme.surface : 'transparent',
        borderColor: lifted ? theme.accent : 'transparent',
        transform: [{ translateY: lifted ? drag.offset : shift }, { scale: lifted ? 1.015 : 1 }],
        shadowColor: '#000', shadowOpacity: lifted ? (theme.dark ? 0.3 : 0.12) : 0,
        shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: lifted ? 5 : 0
      }]}>
        <View pointerEvents={drag ? 'none' : 'auto'} style={{ flex: 1, minWidth: 0 }}>{renderTrack(track, start + offset)}</View>
        <DragHandle register={node => { if (node) handles.current.set(offset, node); else handles.current.delete(offset); }}
          position={offset + 1} total={queue.length - start} label={track.metadata.title} active={!!lifted} first={offset === 0} last={offset === queue.length - start - 1}
          begin={pointerY => begin(offset, pointerY)} update={update} finish={finish} cancel={cancel}
          move={direction => { if (!active.current) { focusTarget.current = offset + direction; move(start + offset, start + offset + direction); } }} />
      </View>;
    })}
  </View>;
}

function DragHandle({ register, position, total, label, active, first, last, begin, update, finish, cancel, move }: {
  register(node: ViewInstance | null): void; position: number; total: number;
  label: string; active: boolean; first: boolean; last: boolean;
  begin(y: number): void; update(y: number): void; finish(): void; cancel(): void; move(direction: number): void;
}) {
  const theme = useAppearance();
  const latest = useRef({ begin, update, finish, cancel });
  latest.current = { begin, update, finish, cancel };
  const webStyle = { touchAction: 'none', cursor: 'pointer' } as const;
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => latest.current.begin(event.nativeEvent.pageY),
    onPanResponderMove: (_, gesture) => latest.current.update(gesture.moveY),
    onPanResponderRelease: () => latest.current.finish(),
    onPanResponderTerminate: () => latest.current.cancel(),
    onPanResponderTerminationRequest: () => false
  })).current;
  return <View ref={register} {...responder.panHandlers} accessible focusable tabIndex={0} accessibilityRole="adjustable" accessibilityLabel={`Reorder ${label}`}
    accessibilityHint={Platform.OS === 'web' ? 'drag to reorder, or use the up and down arrow keys.' : 'drag to reorder, or use the move earlier and move later actions.'}
    aria-valuemin={1} aria-valuemax={total} aria-valuenow={position} aria-valuetext={active ? 'Moving' : `position ${position} of ${total}`}
    accessibilityValue={{ min: 1, max: total, now: position, text: active ? 'Moving' : `position ${position} of ${total}` }}
    accessibilityActions={[...(!first ? [{ name: 'decrement', label: 'move earlier' }] : []), ...(!last ? [{ name: 'increment', label: 'move later' }] : [])]}
    onAccessibilityAction={event => {
      if (event.nativeEvent.actionName === 'decrement' && !first) move(-1);
      if (event.nativeEvent.actionName === 'increment' && !last) move(1);
    }}
    {...(Platform.OS === 'web' ? { onKeyDown: (event: KeyDownEvent) => {
      if (event.nativeEvent.key === 'ArrowUp' && !first) { event.preventDefault(); move(-1); }
      if (event.nativeEvent.key === 'ArrowDown' && !last) { event.preventDefault(); move(1); }
    } } : {})}
    style={[styles.handle, Platform.OS === 'web' ? webStyle : {}]}>
    <View style={{ width: 32, height: 36, borderRadius: 8, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
      <GripHorizontal size={22} color={active ? theme.accent : theme.text} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60, borderRadius: 10, borderWidth: 1 },
  handle: { width: 44, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 56 }
});
