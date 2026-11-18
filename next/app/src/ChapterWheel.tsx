import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { clock, type Chapter } from '@plyr/next-core/chapters';
import { useAppearance } from './appearance';
import { Text } from './Text';

const VISIBLE = 5;
const HOLD_MS = 140;
const CANCEL_DX = 90;

type Mode = 'closed' | 'drag' | 'browse';

/** The "now: <chapter>" line under the scrubber, which opens a picker wheel of the tracklist.
 *  Hold and drag: each chapter is a detent with a selection haptic, and letting go jumps there. Letting go on the playing
 *  chapter, or sliding sideways off the wheel, closes it with playback untouched. A plain tap opens the same wheel to
 *  browse: flick through it, tap a chapter to jump, tap outside to close. Nothing seeks until one of those commits. */
export function ChapterWheel({ chapters, current, seek, onPreview, guard }: {
  chapters: Chapter[]; current: number; seek?: (seconds: number) => void;
  onPreview?: (seconds: number | undefined) => void; guard?: object;
}) {
  const theme = useAppearance();
  const row = 38 * theme.scale;
  const [mode, setMode] = useState<Mode>('closed');
  const [selected, setSelected] = useState(current);
  const [cancel, setCancel] = useState(false);
  const offset = useRef(new Animated.Value(0)).current;
  const bloom = useRef(new Animated.Value(0)).current;
  const gesture = useRef<{ x: number; y: number; from: number; moved: boolean; hold?: ReturnType<typeof setTimeout> } | null>(null);
  const flick = useRef<{ y: number; from: number; moved: boolean } | null>(null);
  const selection = useRef(current);
  const at = useRef(0);
  const chapter = chapters[current];
  const max = (chapters.length - 1) * row;
  const wheelHeight = row * VISIBLE;

  useEffect(() => () => { if (gesture.current?.hold) clearTimeout(gesture.current.hold); }, []);
  useEffect(() => { onPreview?.(mode !== 'closed' && selected !== current ? chapters[selected]?.start : undefined); }, [mode, selected, current, chapters, onPreview]);
  // A track change or a seek from elsewhere while browsing leaves a wheel pointing at nothing useful.
  useEffect(() => { if (mode === 'browse') close(); }, [chapters]);

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
    if (commit && seek && target !== current && chapters[target]) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      seek(chapters[target].start);
    }
    gesture.current = null;
    setCancel(false);
    Animated.timing(bloom, { toValue: 0, duration: theme.reduceMotion ? 0 : 110, useNativeDriver: true }).start(() => setMode('closed'));
  }

  const lineHandlers = seek ? {
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (event: GestureResponderEvent) => {
      const { pageX, pageY } = event.nativeEvent;
      if (mode === 'browse') { close(); return; }
      gesture.current = { x: pageX, y: pageY, from: current * row, moved: false,
        hold: setTimeout(() => { if (gesture.current) open('drag'); }, HOLD_MS) };
    },
    onResponderMove: (event: GestureResponderEvent) => {
      const drag = gesture.current;
      if (!drag) return;
      const dy = event.nativeEvent.pageY - drag.y;
      const dx = event.nativeEvent.pageX - drag.x;
      if (mode === 'closed' && Math.abs(dy) > 4) { clearTimeout(drag.hold); open('drag'); }
      if (Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved && Math.abs(dx) <= CANCEL_DX) return;
      setCancel(Math.abs(dx) > CANCEL_DX);
      scrollTo(drag.from - dy);
    },
    onResponderRelease: () => {
      const drag = gesture.current;
      if (!drag) return;
      clearTimeout(drag.hold);
      if (mode === 'drag' && (drag.moved || cancel)) { close(!cancel); return; }
      gesture.current = null;
      if (mode === 'closed') open('browse');
      else setMode('browse');
    },
    onResponderTerminate: () => { if (gesture.current?.hold) clearTimeout(gesture.current.hold); if (mode === 'drag') close(); },
  } : {};

  const wheelHandlers = {
    onStartShouldSetResponder: () => mode === 'browse',
    onResponderTerminationRequest: () => false,
    onResponderGrant: (event: GestureResponderEvent) => { flick.current = { y: event.nativeEvent.pageY, from: at.current, moved: false }; },
    onResponderMove: (event: GestureResponderEvent) => {
      const state = flick.current;
      if (!state) return;
      const dy = event.nativeEvent.pageY - state.y;
      if (Math.abs(dy) > 4) state.moved = true;
      if (state.moved) scrollTo(state.from - dy);
    },
    onResponderRelease: (event: GestureResponderEvent) => {
      const state = flick.current;
      flick.current = null;
      if (!state) return;
      if (state.moved) { scrollTo(Math.round(at.current / row) * row, true); return; }
      // A tap: the row under the finger, counted from the band in the middle.
      const index = Math.round((at.current + event.nativeEvent.locationY - wheelHeight / 2) / row);
      if (index < 0 || index >= chapters.length) return;
      selection.current = index;
      setSelected(index);
      close(true);
    },
  };

  const hint = cancel ? 'let go to cancel' : selected === current
    ? mode === 'browse' ? 'tap outside to close' : 'let go to keep playing'
    : `${mode === 'browse' ? 'tap' : 'let go'} to jump to ${clock(chapters[selected]?.start ?? 0)}`;
  const caption = { fontFamily: theme.fontFamily, fontSize: 13 * theme.scale };

  return <View style={styles.anchor} {...guard}>
    <View {...lineHandlers} accessible accessibilityRole="button"
      accessibilityLabel={`now: ${chapter.title}${chapter.artist ? ` by ${chapter.artist}` : ''}`}
      accessibilityHint={seek ? 'Opens the tracklist wheel' : undefined}
      accessibilityState={{ expanded: mode !== 'closed', disabled: !seek }}
      onAccessibilityTap={seek ? () => mode === 'closed' ? open('browse') : close() : undefined}
      onAccessibilityEscape={() => close()}
      style={[styles.line, mode !== 'closed' && { backgroundColor: theme.accent + '1f' }]}>
      <Text numberOfLines={1} style={{ ...caption, color: theme.accent }}>now: {chapter.title}</Text>
    </View>
    {mode === 'browse' && <Pressable accessibilityLabel="Close tracklist wheel" onPress={() => close()} style={styles.outside} />}
    {mode !== 'closed' && <Animated.View {...wheelHandlers} accessibilityViewIsModal={mode === 'browse'}
      style={[styles.wheel, {
        height: wheelHeight, top: -wheelHeight / 2 + 10, backgroundColor: theme.dark ? '#1c2029f2' : '#fffffff2', borderColor: theme.border,
        opacity: Animated.multiply(bloom, cancel ? 0.4 : 1),
        transform: [{ scaleX: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }, { scaleY: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }],
      }]}>
      <View pointerEvents="none" style={[styles.band, { height: row, marginTop: -row / 2, backgroundColor: theme.accent + '1f' }]} />
      <Animated.View pointerEvents={mode === 'browse' ? 'box-none' : 'none'}
        style={{ position: 'absolute', left: 0, right: 0, top: wheelHeight / 2 - row / 2, transform: [{ translateY: Animated.multiply(offset, -1) }] }}>
        {chapters.map((item, index) => {
          const d = offset.interpolate({ inputRange: [(index - 3) * row, index * row, (index + 3) * row], outputRange: [3, 0, -3], extrapolate: 'clamp' });
          const isSelected = index === selected;
          return <Animated.View key={item.start} accessible={mode === 'browse'} accessibilityRole="button"
            accessibilityLabel={`Jump to ${clock(item.start)}, ${item.label}`} accessibilityState={{ selected: isSelected }}
            onAccessibilityTap={() => { selection.current = index; setSelected(index); close(true); }}
            style={[styles.row, { height: row,
              opacity: d.interpolate({ inputRange: [-3, 0, 3], outputRange: [0.15, 1, 0.15] }),
              transform: [{ perspective: 400 }, { rotateX: d.interpolate({ inputRange: [-3, 0, 3], outputRange: ['-55deg', '0deg', '55deg'] }) },
                { scale: d.interpolate({ inputRange: [-3, 0, 3], outputRange: [0.85, 1, 0.85] }) }] }]}>
            <Text style={{ ...caption, width: 48 * theme.scale, color: isSelected ? theme.accent : theme.faint, fontVariant: ['tabular-nums'] }}>{clock(item.start)}</Text>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: theme.fontFamily, fontSize: 15 * theme.scale, color: isSelected ? theme.accent : theme.text, fontWeight: isSelected ? '600' : '400' }}>
              {item.title}{item.artist ? <Text style={{ ...caption, color: theme.muted, fontWeight: '400' }}> · {item.artist}</Text> : null}
            </Text>
            <View style={[styles.dot, { backgroundColor: theme.accent, opacity: index === current ? 1 : 0 }]} />
          </Animated.View>;
        })}
      </Animated.View>
      <Text pointerEvents="none" accessibilityLiveRegion="polite" style={[styles.hint, { ...caption, fontSize: 12 * theme.scale, color: theme.muted, backgroundColor: theme.dark ? '#1c2029' : '#ffffff' }]}>{hint}</Text>
    </Animated.View>}
  </View>;
}

const styles = StyleSheet.create({
  anchor: { flex: 1, alignItems: 'center', zIndex: 10 },
  line: { maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  outside: { position: 'absolute', top: -2000, bottom: -2000, left: -2000, right: -2000 },
  wheel: { position: 'absolute', left: -60, right: -60, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  band: { position: 'absolute', left: 10, right: 10, top: '50%', borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  hint: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingVertical: 4, textAlign: 'center' },
});
