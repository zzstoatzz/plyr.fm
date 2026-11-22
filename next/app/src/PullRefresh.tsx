import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, RefreshControl, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BARS, armKick, barLight, barStep, pullKick, pullMove, refreshMessage, restingPull, waveTarget,
  type Bar, type RefreshResult, type WavePhase,
} from '@plyr/next-core/behaviors/pull-refresh';
import { useAppearance } from './appearance';
import { Text } from './Text';

// UIRefreshControl only fires on a slow drag past ~186pt of pull and misses fast ones, so the
// wave arms sooner and letting go armed starts the refresh itself. HOLD is the gap it keeps open.
const THRESHOLD = 120;
const HOLD = 60;
const SETTLED_MS = 1250;

function feel(event: 'tick' | 'arm' | 'release' | 'success' | 'warning') {
  const played = event === 'tick' ? Haptics.selectionAsync()
    : event === 'arm' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)
      : event === 'release' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)
        : Haptics.notificationAsync(event === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  played.catch(() => {});
}

/**
 * Pull-to-refresh with UIRefreshControl's mechanics and plyr.fm's wave. The system control keeps
 * the rubber band, fires the refresh and holds the gap; its spinner is tinted clear and the wave
 * tunes in inside the gap instead.
 */
export function usePullRefresh(onRefresh: () => Promise<RefreshResult>) {
  const colors = useAppearance();
  const top = useSafeAreaInsets().top;
  const [holding, setHolding] = useState(false);
  const [message, setMessage] = useState('');
  const latest = useRef(onRefresh);
  useEffect(() => { latest.current = onRefresh; });
  const reduced = useRef(colors.reduceMotion);
  reduced.current = colors.reduceMotion;

  const gap = useRef(new Animated.Value(0)).current;
  const shown = useRef(new Animated.Value(0)).current;
  const heights = useRef(Array.from({ length: BARS }, () => new Animated.Value(0.12))).current;
  const lights = useRef(Array.from({ length: BARS }, () => new Animated.Value(0.45))).current;
  const state = useRef({
    pull: 0, dragging: false, engaged: false, gesture: restingPull, phase: 'idle' as WavePhase,
    wave: Array.from({ length: BARS }, (): Bar => ({ height: 0.12, velocity: 0 })),
    frame: 0, last: 0, lastPull: 0, lastSpeed: 0, started: 0,
  }).current;

  const step = useCallback((now: number) => {
    state.frame = 0;
    const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 1 / 60;
    state.last = now;
    const pull = Math.max(0, state.pull);
    const speed = (pull - state.lastPull) / dt;
    const speedChange = speed - state.lastSpeed;
    state.lastPull = pull;
    state.lastSpeed = speed;
    const live = state.phase !== 'idle';
    gap.setValue(pull);
    shown.setValue(live ? Math.min(1, Math.max(0, (pull - 14) / 34)) : state.engaged ? Math.min(1, Math.max(0, (pull - 12) / 48)) : 0);
    const progress = pull / THRESHOLD;
    const kicking = state.dragging && state.engaged && state.phase === 'idle' && !reduced.current;
    state.wave = state.wave.map((bar, index) => {
      const target = waveTarget(index, state.phase, progress, state.gesture.armed, (now - state.started) / 1000);
      if (reduced.current) return { height: target, velocity: 0 };
      return barStep(kicking ? { ...bar, velocity: bar.velocity + pullKick(index, speedChange) } : bar, target, dt);
    });
    state.wave.forEach((bar, index) => {
      heights[index].setValue(bar.height);
      lights[index].setValue(state.phase === 'settled' ? 0 : state.gesture.armed || state.phase === 'refreshing' ? 1 : 0.45 + 0.55 * barLight(index, progress));
    });
    const resting = !live && pull < 0.5 && !state.dragging && state.wave.every(bar => Math.abs(bar.velocity) < 0.01);
    if (resting) state.last = 0;
    else state.frame = requestAnimationFrame(step);
  }, [state, gap, shown, heights, lights]);
  const run = useCallback(() => { if (!state.frame) state.frame = requestAnimationFrame(step); }, [state, step]);
  useEffect(() => () => cancelAnimationFrame(state.frame), [state]);

  const begin = useCallback(() => {
    if (state.phase !== 'idle') return;
    setHolding(true);
    state.phase = 'refreshing';
    state.started = performance.now();
    AccessibilityInfo.announceForAccessibility('refreshing');
    run();
    void latest.current().catch((): RefreshResult => ({ ok: false })).then(result => {
      state.phase = 'settled';
      const text = refreshMessage(result);
      setMessage(text);
      feel(result.ok ? 'success' : 'warning');
      AccessibilityInfo.announceForAccessibility(text);
      run();
      setTimeout(() => setHolding(false), SETTLED_MS);
    });
  }, [state, run]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    state.pull = -(event.nativeEvent.contentOffset.y + top);
    if (state.phase === 'settled' && !holding && state.pull <= 0.5) {
      state.phase = 'idle';
      state.engaged = false;
      setMessage('');
    }
    if (state.pull > 0.5 || state.phase !== 'idle') run();
    if (state.phase !== 'idle' || !state.dragging || !state.engaged) return;
    const next = pullMove(state.gesture, state.pull, THRESHOLD);
    state.gesture = next.state;
    if (next.event === 'tick') feel('tick');
    if (next.event === 'arm') {
      feel('arm');
      if (!reduced.current) state.wave = state.wave.map((bar, index) => ({ ...bar, velocity: bar.velocity + armKick(index) }));
    }
  }, [state, top, run, holding]);

  const onScrollBeginDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    state.dragging = true;
    if (state.phase !== 'idle') return;
    state.engaged = event.nativeEvent.contentOffset.y + top <= 1;
    state.gesture = restingPull;
  }, [state, top]);

  const onScrollEndDrag = useCallback(() => {
    state.dragging = false;
    const fire = state.gesture.armed && state.phase === 'idle';
    state.gesture = { ...state.gesture, armed: false };
    if (fire) {
      feel('release');
      begin();
    }
    run();
  }, [state, run, begin]);

  const refreshControl = <RefreshControl refreshing={holding} onRefresh={begin} tintColor="transparent" />;

  const barHeight = 34 * colors.scale;
  const indicator = <View pointerEvents="none" style={{ position: 'absolute', top, left: 0, right: 0, alignItems: 'center' }}>
    <Animated.View style={{ height: gap, alignSelf: 'stretch', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', opacity: shown }}>
      {message ? <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 14 * colors.scale }}>{message}</Text>
        : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: barHeight * 1.35 }}>
          {heights.map((height, index) => <Animated.View key={index} style={{
            width: 6, height: barHeight, borderRadius: 3, backgroundColor: colors.accent, opacity: lights[index], transform: [{ scaleY: height }],
          }} />)}
        </View>}
    </Animated.View>
  </View>;

  return { refreshControl, indicator, onScroll, onScrollBeginDrag, onScrollEndDrag };
}
