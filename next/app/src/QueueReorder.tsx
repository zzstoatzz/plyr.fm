import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { DotsSix as GripHorizontal } from './icons';
import { Animated, PanResponder, StyleSheet, useWindowDimensions, View, type ScrollViewInstance, type ViewInstance } from 'react-native';
import type { Track } from '@plyr/next-core/api';
import * as Haptics from 'expo-haptics';
import { GestureDetector, useCompetingGestures, usePanGesture } from 'react-native-gesture-handler';
import { useAppearance } from './appearance';
import { autoscrollVelocity, dragTarget, landingTop, rowShift, type Row } from '@plyr/next-core/behaviors/reorder';
import { useCancelOnLeave } from './behaviors/use-cancel-on-leave';
import { useReorderHandle } from './behaviors/use-reorder-handle';

export interface ScrollMetrics { offset: number; height: number; contentHeight: number }
interface Drag {
  queue: Track[]; start: number; from: number; to: number;
  initialY: number; pointerY: number; initialScroll: number; offset: number;
  top: number; bottom: number; rows: Row[];
}

export function QueueReorder({ queue, start, move, remove, renderTrack, renderHeader, scrollRef, scrollMetrics, onDragging }: {
  queue: Track[]; start: number; move(from: number, to: number): void; remove?(index: number): void;
  renderTrack(track: Track, index: number): ReactNode;
  /** Content above a row that stays put while that row is dragged, such as a section label. */
  renderHeader?(index: number): ReactNode;
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
  useCancelOnLeave(!!drag, cancel);

  function update(pointerY: number) {
    const current = active.current;
    if (!current) return;
    if (current.queue !== latest.current.queue || current.start !== latest.current.start) { cancel(); return; }
    const rawOffset = pointerY - current.initialY + scrollMetrics.current.offset - current.initialScroll;
    const { offset, to } = dragTarget(current.rows, current.from, rawOffset);
    if (to !== current.to) void Haptics.selectionAsync().catch(() => {});
    active.current = { ...current, pointerY, offset, to };
    setDrag(active.current);
  }

  function autoscroll() {
    const current = active.current;
    if (!current) return;
    const metrics = scrollMetrics.current;
    const velocity = autoscrollVelocity(current.pointerY, current.top, current.bottom);
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

  const landing = drag ? landingTop(drag.rows, drag.from, drag.to) : null;
  return <View>
    {landing !== null && <View pointerEvents="none" style={{ position: 'absolute', top: landing, left: 8, right: 8, height: 2, borderRadius: 1, backgroundColor: theme.accent, zIndex: 3 }} />}
    {queue.slice(start).map((track, offset) => {
      const lifted = drag?.from === offset;
      const shift = drag ? rowShift(drag.rows, drag.from, drag.to, offset) : 0;
      return <Fragment key={`${track.id}:${start + offset}`}>{renderHeader?.(start + offset)}<View onLayout={event => {
        layouts.current.set(offset, { top: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height });
      }} style={[styles.row, {
        zIndex: lifted ? 2 : 0, backgroundColor: lifted ? theme.surface : 'transparent',
        borderColor: lifted ? theme.accent : 'transparent',
        transform: [{ translateY: lifted ? drag.offset : shift }, { scale: lifted ? 1.015 : 1 }],
        shadowColor: '#000', shadowOpacity: lifted ? (theme.dark ? 0.3 : 0.12) : 0,
        shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: lifted ? 5 : 0
      }]}>
        <RowHold begin={pointerY => begin(offset, pointerY)} update={update} finish={finish} cancel={cancel}
          remove={remove && !drag ? () => remove(start + offset) : undefined}>
          <View pointerEvents={drag ? 'none' : 'auto'} style={{ flex: 1, minWidth: 0 }}>{renderTrack(track, start + offset)}</View>
        </RowHold>
        <DragHandle register={node => { if (node) handles.current.set(offset, node); else handles.current.delete(offset); }}
          position={offset + 1} total={queue.length - start} label={track.metadata.title} active={!!lifted}
          begin={pointerY => begin(offset, pointerY)} update={update} finish={finish} cancel={cancel}
          move={delta => { if (!active.current) { focusTarget.current = offset + delta; move(start + offset, start + offset + delta); } }} />
      </View></Fragment>;
    })}
  </View>;
}

/** Hold anywhere on a row, then drag: a quick tap still plays it and a quick swipe still scrolls. */
function RowHold({ begin, update, finish, cancel, remove, children }: {
  begin(y: number): void; update(y: number): void; finish(): void; cancel(): void; remove?: () => void; children: ReactNode;
}) {
  const theme = useAppearance();
  const latest = useRef({ begin, update, finish, cancel, remove });
  latest.current = { begin, update, finish, cancel, remove };
  const held = useRef(false);
  const slide = useRef(new Animated.Value(0)).current;
  const swiped = useRef(0);
  const hold = usePanGesture({
    runOnJS: true, activateAfterLongPress: 320,
    onActivate: event => {
      held.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      latest.current.begin(event.absoluteY);
    },
    onUpdate: event => { if (held.current) latest.current.update(event.absoluteY); },
    onFinalize: event => {
      if (!held.current) return;
      held.current = false;
      if (event.canceled) latest.current.cancel(); else latest.current.finish();
    },
  });
  const swipe = usePanGesture({
    runOnJS: true, enabled: !!remove, activeOffsetX: -16, failOffsetY: [-12, 12],
    onBegin: () => { swiped.current = 0; },
    onUpdate: event => { swiped.current = Math.min(0, event.translationX); slide.setValue(swiped.current); },
    onFinalize: event => {
      if (!event.canceled && swiped.current < -96 && latest.current.remove) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        latest.current.remove();
        slide.setValue(0);
      } else Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start();
    },
  });
  const gesture = useCompetingGestures(hold, swipe);
  return <GestureDetector gesture={gesture}><View style={{ flex: 1, minWidth: 0, borderRadius: 10, overflow: 'hidden' }}>
    {remove && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.danger, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 16 }]}>
      <Animated.Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 * theme.scale, opacity: slide.interpolate({ inputRange: [-96, -24, 0], outputRange: [1, 0.4, 0] }) }}>remove</Animated.Text>
    </View>}
    <Animated.View style={{ backgroundColor: theme.background, transform: [{ translateX: slide }] }}>{children}</Animated.View>
  </View></GestureDetector>;
}

function DragHandle({ register, position, total, label, active, begin, update, finish, cancel, move }: {
  register(node: ViewInstance | null): void; position: number; total: number; label: string; active: boolean;
  begin(y: number): void; update(y: number): void; finish(): void; cancel(): void; move(delta: number): void;
}) {
  const theme = useAppearance();
  const handle = useReorderHandle({ label, position, total, moving: active, move });
  const latest = useRef({ begin, update, finish, cancel });
  latest.current = { begin, update, finish, cancel };
    const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => latest.current.begin(event.nativeEvent.pageY),
    onPanResponderMove: (_, gesture) => latest.current.update(gesture.moveY),
    onPanResponderRelease: () => latest.current.finish(),
    onPanResponderTerminate: () => latest.current.cancel(),
    onPanResponderTerminationRequest: () => false
  })).current;
  return <View ref={register} {...responder.panHandlers} {...handle} style={styles.handle}>
    <View style={{ width: 32, height: 36, borderRadius: 8, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' }}>
      <GripHorizontal size={22} color={active ? theme.accent : theme.text} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60, borderRadius: 10, borderWidth: 1 },
  handle: { width: 44, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 56 }
});
