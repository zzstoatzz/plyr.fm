import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { GestureDetector, usePanGesture, type NativeGesture, type PanGesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { clock, type Chapter } from '@plyr/next-core/chapters';
import { useAppearance } from './appearance';
import { Text } from './Text';

const VISIBLE = 5;
const HOLD_MS = 140;
const CANCEL_DX = 90;

type Mode = 'closed' | 'drag' | 'browse';

/** Shared with the page: the wheel marks touches that start inside it, and the page calls `close` for any other touch. */
export type WheelOutside = { inside: boolean; openedAt?: number; close?: () => void };

/** The "now: <chapter>" line under the scrubber, which opens a picker wheel of the tracklist.
 *  Hold and drag: each chapter is a detent with a selection haptic, and letting go jumps there. Letting go on the chapter
 *  that was playing when the wheel opened, or sliding sideways off the wheel, closes it with playback untouched. A plain
 *  tap opens the same wheel to browse: flick through it, tap a chapter to jump, tap outside to close.
 *  `onActive` is true from a touch on the line until the wheel closes, so the page holds still under it. `outside` lets the
 *  page close an open wheel on any touch that didn't start in it, wherever that touch lands. */
export function ChapterWheel({ chapters, current, seek, onPreview, onActive, guard, blocks, outside }: {
  chapters: Chapter[]; current: number; seek?: (seconds: number) => void;
  onPreview?: (seconds: number | undefined) => void; onActive?: (active: boolean) => void; guard?: object; blocks?: (PanGesture | NativeGesture)[];
  outside?: { current: WheelOutside };
}) {
  const { width: windowWidth } = useWindowDimensions();
  const theme = useAppearance();
  const row = 38 * theme.scale;
  const wheelHeight = row * VISIBLE;
  const max = (chapters.length - 1) * row;
  const [mode, setModeState] = useState<Mode>('closed');
  const [selected, setSelected] = useState(current);
  const [cancel, setCancelState] = useState(false);
  const [origin, setOrigin] = useState(current);
  // Handlers read these refs, not render state: a release can land before the render a move asked for.
  const modeRef = useRef<Mode>('closed');
  const cancelRef = useRef(false);
  const originRef = useRef(current);
  const selection = useRef(current);
  const at = useRef(0);
  const wheelRef = useRef<ViewInstance>(null);
  const gesture = useRef<{ x: number; y: number; from: number; moved: boolean; hold?: ReturnType<typeof setTimeout> } | null>(null);
  const flick = useRef<{ y: number; from: number; moved: boolean } | null>(null);
  const offset = useRef(new Animated.Value(0)).current;
  const bloom = useRef(new Animated.Value(0)).current;
  const dim = useRef(new Animated.Value(1)).current;

  const setMode = (next: Mode) => { modeRef.current = next; setModeState(next); };
  const setCancel = (next: boolean) => {
    if (cancelRef.current === next) return;
    cancelRef.current = next;
    setCancelState(next);
    Animated.timing(dim, { toValue: next ? 0.4 : 1, duration: 100, useNativeDriver: true }).start();
  };

  // Built once per tracklist: rebuilding Animated nodes on every detent re-attaches them to the native driver mid-spring.
  const animated = useMemo(() => ({
    rows: { translateY: Animated.multiply(offset, -1) },
    wheel: { opacity: Animated.multiply(bloom, dim), scaleX: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }), scaleY: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
    items: chapters.map((_, index) => {
      const d = offset.interpolate({ inputRange: [(index - 3) * row, index * row, (index + 3) * row], outputRange: [3, 0, -3], extrapolate: 'clamp' });
      return {
        opacity: d.interpolate({ inputRange: [-3, 0, 3], outputRange: [0.15, 1, 0.15] }),
        rotateX: d.interpolate({ inputRange: [-3, 0, 3], outputRange: ['-55deg', '0deg', '55deg'] }),
        scale: d.interpolate({ inputRange: [-3, 0, 3], outputRange: [0.85, 1, 0.85] }),
      };
    }),
  }), [chapters, row, offset, bloom, dim]);

  useEffect(() => { onPreview?.(mode !== 'closed' && selected !== origin ? chapters[selected]?.start : undefined); }, [mode, selected, origin, chapters, onPreview]);
  // Browsing holds the page still too, so the first flick on a fresh wheel can't scroll the page instead.
  useEffect(() => { if (mode === 'browse') onActive?.(true); }, [mode, onActive]);
  useEffect(() => {
    if (!outside) return;
    outside.current.close = mode === 'browse' ? () => handlers.current.close() : undefined;
    // While the wheel is still blooming open it's smaller than it will be, so a quick flick can land past its edge.
    if (mode === 'browse') outside.current.openedAt = Date.now();
    return () => { outside.current.close = undefined; };
  }, [mode, outside]);
  useEffect(() => () => { onPreview?.(undefined); onActive?.(false); if (gesture.current?.hold) clearTimeout(gesture.current.hold); }, [onPreview, onActive]);
  // A new track leaves an open wheel pointing at the old tracklist.
  useEffect(() => { if (modeRef.current !== 'closed') close(); }, [chapters]);

  const handlers = useRef({ close() {}, lineBegin() {}, lineMove(_dx: number, _dy: number) {}, lineEnd(_canceled: boolean) {}, wheelBegin() {}, wheelMove(_dy: number) {}, wheelEnd(_y: number) {} });
  const lineActive = useRef(false);
  const linePan = usePanGesture({
    runOnJS: true, enabled: !!seek, block: blocks, minDistance: 4,
    onBegin: () => { lineActive.current = false; handlers.current.lineBegin(); },
    onUpdate: event => { lineActive.current = true; handlers.current.lineMove(event.translationX, event.translationY); },
    onFinalize: event => handlers.current.lineEnd(event.canceled && lineActive.current),
  });
  const wheelPan = usePanGesture({
    runOnJS: true, enabled: mode === 'browse', block: blocks, minDistance: 4,
    onBegin: () => handlers.current.wheelBegin(),
    onUpdate: event => handlers.current.wheelMove(event.translationY),
    onFinalize: event => handlers.current.wheelEnd(event.y),
  });

  const chapter = chapters[current];
  if (!chapter) return null;

  function scrollTo(value: number, animate = false) {
    at.current = Math.max(0, Math.min(max, value));
    if (animate) Animated.spring(offset, { toValue: at.current, useNativeDriver: true, speed: 30, bounciness: 0 }).start();
    else offset.setValue(at.current);
    const next = Math.round(at.current / row);
    if (next !== selection.current) {
      selection.current = next;
      setSelected(next);
      void Haptics.selectionAsync().catch(() => {});
    }
  }
  function open(next: Mode) {
    originRef.current = current;
    setOrigin(current);
    selection.current = current;
    setSelected(current);
    setCancel(false);
    at.current = current * row;
    offset.setValue(at.current);
    setMode(next);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Animated.spring(bloom, { toValue: 1, useNativeDriver: true, speed: theme.reduceMotion ? 1000 : 22, bounciness: theme.reduceMotion ? 0 : 6 }).start();
  }
  function close(commit = false) {
    const target = selection.current;
    if (commit && seek && target !== originRef.current && chapters[target]) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      seek(chapters[target].start);
    }
    if (gesture.current?.hold) clearTimeout(gesture.current.hold);
    gesture.current = null;
    flick.current = null;
    setCancel(false);
    onActive?.(false);
    modeRef.current = 'closed';
    Animated.timing(bloom, { toValue: 0, duration: theme.reduceMotion ? 0 : 110, useNativeDriver: true }).start(() => {
      if (modeRef.current === 'closed') setModeState('closed');
    });
  }
  function pick(index: number) {
    selection.current = index;
    setSelected(index);
    close(true);
  }

  // Native gestures, not JS responders: the sheet's pull and the page's scroll are native too, and a native recognizer
  // takes a touch from a JS responder whatever it answers. These block both, so a drag that starts here stays here.
  function lineBegin() {
    if (!seek) return;
    if (modeRef.current === 'browse') { close(); return; }
    onActive?.(true);
    gesture.current = { x: 0, y: 0, from: current * row, moved: false,
      hold: setTimeout(() => { if (gesture.current && modeRef.current === 'closed') open('drag'); }, HOLD_MS) };
  }
  function lineMove(dx: number, dy: number) {
    const drag = gesture.current;
    if (!drag) return;
    if (modeRef.current === 'closed') { clearTimeout(drag.hold); open('drag'); }
    if (modeRef.current !== 'drag') return;
    drag.moved = true;
    setCancel(Math.abs(dx) > CANCEL_DX);
    scrollTo(drag.from - dy);
  }
  function lineEnd(canceledBySystem: boolean) {
    const drag = gesture.current;
    if (!drag) return;
    clearTimeout(drag.hold);
    if (modeRef.current === 'drag' && (drag.moved || canceledBySystem)) { close(drag.moved && !canceledBySystem && !cancelRef.current); return; }
    gesture.current = null;
    if (modeRef.current === 'closed') open('browse');
    else setMode('browse');
  }
  function wheelBegin() {
    if (modeRef.current !== 'browse') return;
    flick.current = { y: 0, from: at.current, moved: false };
  }
  function wheelMove(dy: number) {
    const state = flick.current;
    if (!state) return;
    state.moved = true;
    scrollTo(state.from - dy);
  }
  function wheelEnd(y: number) {
    const state = flick.current;
    flick.current = null;
    if (!state) return;
    if (state.moved) { scrollTo(Math.round(at.current / row) * row, true); return; }
    // A tap: the row under the finger, counted from the band in the middle of the wheel.
    const index = Math.round((at.current + y - wheelHeight / 2) / row);
    if (index >= 0 && index < chapters.length) pick(index);
  }
  handlers.current = { close: () => close(), lineBegin, lineMove, lineEnd, wheelBegin, wheelMove, wheelEnd };

  const hint = cancel ? 'let go to cancel' : selected === origin
    ? mode === 'browse' ? 'tap outside to close' : 'let go to keep playing'
    : `${mode === 'browse' ? 'tap' : 'let go'} to jump to ${clock(chapters[selected]?.start ?? 0)}`;
  const caption = { fontFamily: theme.fontFamily, fontSize: 13 * theme.scale };
  const wheelWidth = Math.min(420, windowWidth - 32);
  const surface = theme.dark ? '#1c2029' : '#ffffff';

  return <View style={styles.anchor} {...guard} onTouchStart={() => { if (outside) outside.current.inside = true; }}>
    <GestureDetector gesture={linePan}><View accessible accessibilityRole="button"
      accessibilityLabel={`now: ${chapter.title}${chapter.artist ? ` by ${chapter.artist}` : ''}`}
      accessibilityHint={seek ? 'Opens the tracklist wheel' : undefined}
      accessibilityState={{ expanded: mode !== 'closed', disabled: !seek }}
      onAccessibilityTap={seek ? () => modeRef.current === 'closed' ? open('browse') : close() : undefined}
      style={[styles.line, mode !== 'closed' && { backgroundColor: theme.accent + '1f' }]}>
      <Text numberOfLines={1} style={{ ...caption, color: theme.accent }}>now: {chapter.title}</Text>
    </View></GestureDetector>
    {mode === 'browse' && <Pressable accessible={false} onPress={() => close()} style={styles.outside} />}
    {mode !== 'closed' && <GestureDetector gesture={wheelPan}><Animated.View ref={wheelRef} accessibilityViewIsModal={mode === 'browse'}
      onAccessibilityEscape={() => close()}
      style={[styles.wheel, {
        height: wheelHeight, top: -wheelHeight / 2 + 10, width: wheelWidth, marginLeft: -wheelWidth / 2, backgroundColor: surface, borderColor: theme.border,
        opacity: animated.wheel.opacity, transform: [{ scaleX: animated.wheel.scaleX }, { scaleY: animated.wheel.scaleY }],
      }]}>
      <View pointerEvents="none" style={[styles.band, { height: row, marginTop: -row / 2, backgroundColor: theme.accent + '1f' }]} />
      <Animated.View pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, top: wheelHeight / 2 - row / 2, transform: [animated.rows] }}>
        {chapters.map((item, index) => {
          const isSelected = index === selected;
          const motion = animated.items[index];
          return <Animated.View key={item.start} accessible={mode === 'browse'} accessibilityRole="button"
            accessibilityLabel={`Jump to ${clock(item.start)}, ${item.label}`} accessibilityState={{ selected: isSelected }}
            onAccessibilityTap={() => pick(index)}
            style={[styles.row, { height: row, opacity: motion.opacity,
              transform: [{ perspective: 400 }, { rotateX: motion.rotateX }, { scale: motion.scale }] }]}>
            <Text style={{ ...caption, width: 48 * theme.scale, color: isSelected ? theme.accent : theme.faint, fontVariant: ['tabular-nums'] }}>{clock(item.start)}</Text>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, color: isSelected ? theme.accent : theme.text, fontWeight: isSelected ? '600' : '400' }}>
              {item.title}{item.artist ? <Text style={{ ...caption, color: theme.muted, fontWeight: '400' }}> · {item.artist}</Text> : null}
            </Text>
            <View style={[styles.dot, { backgroundColor: theme.accent, opacity: index === current ? 1 : 0 }]} />
          </Animated.View>;
        })}
      </Animated.View>
      <Text pointerEvents="none" accessibilityLiveRegion="polite" style={[styles.hint, { ...caption, fontSize: 12 * theme.scale, color: theme.muted, backgroundColor: surface }]}>{hint}</Text>
    </Animated.View></GestureDetector>}
  </View>;
}

const styles = StyleSheet.create({
  anchor: { flex: 1, alignItems: 'center', zIndex: 10 },
  line: { maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  outside: { position: 'absolute', top: -2000, bottom: -2000, left: -2000, right: -2000 },
  wheel: { position: 'absolute', left: '50%', borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  band: { position: 'absolute', left: 10, right: 10, top: '50%', borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  hint: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 4, textAlign: 'center' },
});
