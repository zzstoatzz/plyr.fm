import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BARS, WAVE_CYCLE_MS, armKick, barLight, barStep, pullKick, pullMove, refreshMessage, restingPull, resultHold, waveEndDelay, waveTarget,
  type Bar, type RefreshResult,
} from '@plyr/next-core/behaviors/pull-refresh';
import { useAppearance } from './appearance';
import { Text } from './Text';

const THRESHOLD = 120;
const HOLD = 60;
const STAGE = 56;
const KNEE_LOW = 20;
const KNEE_HIGH = 100;
/** Under this pull the shift hides the bounce to within a point, so it can be ended. */
const CUT = 30;
/** [pull, shift]: the content shows at pull + shift, easing into the gap instead of stopping dead at it. */
const KNEE: (readonly [number, number])[] = [[0, HOLD], ...Array.from({ length: 9 }, (_, i) => {
  const pull = KNEE_LOW + (KNEE_HIGH - KNEE_LOW) * i / 8;
  const shown = HOLD + (pull - KNEE_LOW) ** 2 / (2 * (KNEE_HIGH - KNEE_LOW));
  return [pull, Math.max(0, shown - pull)] as const;
})];

function feel(event: 'tick' | 'arm' | 'release' | 'success' | 'warning') {
  const played = event === 'tick' ? Haptics.selectionAsync()
    : event === 'arm' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)
      : event === 'release' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)
        : Haptics.notificationAsync(event === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  played.catch(() => {});
}

type Phase = 'idle' | 'refreshing' | 'closing';

/**
 * Pull-to-refresh with plyr.fm's wave in the gap. No UIRefreshControl: it misses fast pulls, and
 * starting it from code jumps the content by its own height. Letting go past the line refreshes;
 * the list is shifted down by whatever the bounce gives back under the gap, so it settles into the
 * gap without touching the scroll view (a content inset that lands mid-bounce makes UIKit jump).
 * Everything that moves while the refresh runs is on the native driver, so a busy JS thread
 * can't freeze it.
 */
export function usePullRefresh(
  onRefresh: () => Promise<RefreshResult>,
  jumpTo: (offset: number) => void,
  onScrolled: (event: NativeSyntheticEvent<NativeScrollEvent>) => void,
) {
  const colors = useAppearance();
  const top = useSafeAreaInsets().top;
  const latest = useRef(onRefresh);
  useEffect(() => { latest.current = onRefresh; });
  const reduced = useRef(colors.reduceMotion);
  reduced.current = colors.reduceMotion;

  const scrollY = useRef(new Animated.Value(-top)).current;
  const loop = useRef(new Animated.Value(0)).current;
  const waving = useRef(new Animated.Value(0)).current;
  const visible = useRef(new Animated.Value(0)).current;
  const holding = useRef(new Animated.Value(0)).current;
  const pulled = useRef(Array.from({ length: BARS }, () => new Animated.Value(0.12))).current;
  const lights = useRef(Array.from({ length: BARS }, () => new Animated.Value(0.45))).current;
  const [message, setMessage] = useState('');
  const state = useRef({
    pull: 0, dragging: false, engaged: false, gesture: restingPull, phase: 'idle' as Phase,
    wave: Array.from({ length: BARS }, (): Bar => ({ height: 0.12, velocity: 0 })),
    frame: 0, last: 0, lastPull: 0, lastSpeed: 0, started: 0, cut: false, closeOnRelease: false, animation: undefined as Animated.CompositeAnimation | undefined,
  }).current;

  // The level-meter jiggle while pulling runs on JS; the finger is the only thing happening then.
  const step = useCallback((now: number) => {
    state.frame = 0;
    const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 1 / 60;
    state.last = now;
    const pull = Math.max(0, state.pull);
    const speed = (pull - state.lastPull) / dt;
    const speedChange = speed - state.lastSpeed;
    state.lastPull = pull;
    state.lastSpeed = speed;
    const progress = pull / THRESHOLD;
    const kicking = state.dragging && state.engaged && !reduced.current;
    state.wave = state.wave.map((bar, index) => {
      const target = waveTarget(index, 'idle', progress, state.gesture.armed, 0);
      if (reduced.current) return { height: target, velocity: 0 };
      return barStep(kicking ? { ...bar, velocity: bar.velocity + pullKick(index, speedChange) } : bar, target, dt);
    });
    state.wave.forEach((bar, index) => {
      pulled[index].setValue(bar.height);
      lights[index].setValue(state.gesture.armed ? 1 : 0.45 + 0.55 * barLight(index, progress));
    });
    const resting = state.phase !== 'idle' || (!state.dragging && pull < 0.5 && state.wave.every(bar => Math.abs(bar.velocity) < 0.01));
    if (resting) state.last = 0;
    else state.frame = requestAnimationFrame(step);
  }, [state, pulled, lights]);
  const run = useCallback(() => { if (!state.frame && state.phase === 'idle') state.frame = requestAnimationFrame(step); }, [state, step]);
  useEffect(() => () => { cancelAnimationFrame(state.frame); state.animation?.stop(); holding.stopAnimation(); }, [state, holding]);

  const settle = useCallback(() => {
    state.phase = 'idle';
    state.engaged = false;
    state.animation?.stop();
    waving.setValue(0);
    // a finger still holding the gap open keeps the bars until it lets the gap close
    if (state.dragging || state.pull > 0.5) run();
    else visible.setValue(0);
    setMessage('');
  }, [state, waving, visible, run]);

  const close = useCallback(() => {
    state.phase = 'closing';
    state.closeOnRelease = false;
    Animated.timing(holding, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false })
      .start(() => settle());
  }, [state, holding, settle]);

  const begin = useCallback(() => {
    state.phase = 'refreshing';
    state.cut = false;
    state.started = performance.now();
    cancelAnimationFrame(state.frame);
    state.frame = 0;
    lights.forEach(light => light.setValue(1));
    visible.setValue(1);
    waving.setValue(1);
    loop.setValue(0);
    if (!reduced.current) {
      state.animation = Animated.loop(Animated.timing(loop, { toValue: 1, duration: WAVE_CYCLE_MS, easing: Easing.linear, useNativeDriver: true, isInteraction: false }));
      state.animation.start();
    }
    holding.setValue(1);
    AccessibilityInfo.announceForAccessibility('refreshing');
    void latest.current().catch((): RefreshResult => ({ ok: false })).then(async result => {
      await new Promise(done => setTimeout(done, waveEndDelay(performance.now() - state.started)));
      const text = refreshMessage(result);
      const hold = resultHold(result);
      feel(result.ok ? 'success' : 'warning');
      AccessibilityInfo.announceForAccessibility(text);
      if (hold) {
        setMessage(text);
        await new Promise(done => setTimeout(done, hold));
      }
      // closing under a finger fights it; wait for the finger to let go
      if (state.dragging) state.closeOnRelease = true;
      else close();
    });
  }, [state, lights, visible, waving, loop, holding, close]);

  const listener = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScrolled(event);
    state.pull = -(event.nativeEvent.contentOffset.y + top);
    // under the knee the shift hides the rest of the bounce, but a bouncing scroll view eats taps; end it
    if (state.phase === 'refreshing' && !state.dragging && !state.cut && state.pull < CUT) {
      state.cut = true;
      if (state.pull > 0.5) jumpTo(-top);
    }
    if (state.phase !== 'idle') return;
    if (state.pull > 0.5) run();
    if (!state.dragging || !state.engaged) return;
    const next = pullMove(state.gesture, state.pull, THRESHOLD);
    state.gesture = next.state;
    if (next.event === 'tick') feel('tick');
    if (next.event === 'arm') {
      feel('arm');
      if (!reduced.current) state.wave = state.wave.map((bar, index) => ({ ...bar, velocity: bar.velocity + armKick(index) }));
    }
  }, [state, top, run, jumpTo, onScrolled]);
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true, listener }), [scrollY, listener]);

  const onScrollBeginDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    state.dragging = true;
    if (state.phase !== 'idle') return;
    state.engaged = event.nativeEvent.contentOffset.y + top <= 1;
    state.gesture = restingPull;
    visible.setValue(state.engaged ? 1 : 0);
  }, [state, top, visible]);

  const onScrollEndDrag = useCallback(() => {
    state.dragging = false;
    if (state.closeOnRelease) close();
    const fire = state.gesture.armed && state.phase === 'idle';
    state.gesture = { ...state.gesture, armed: false };
    if (fire) {
      feel('release');
      begin();
    } else run();
  }, [state, run, begin, close]);

  // gap in points: the pull from the native scroll position, plus the shift that holds it open.
  // The stage sits centred in the gap and shrinks with it, so the wave closes with the gap.
  const pull = useMemo(() => Animated.multiply(Animated.add(scrollY, top), -1), [scrollY, top]);
  const shift = useMemo(() => Animated.multiply(holding, pull.interpolate({ inputRange: KNEE.map(([p]) => p), outputRange: KNEE.map(([, s]) => s), extrapolate: 'clamp' })), [holding, pull]);
  const gap = useMemo(() => Animated.add(pull, shift), [pull, shift]);
  const listStyle = useMemo(() => ({ transform: [{ translateY: shift }] }), [shift]);
  const stage = useMemo(() => ({
    opacity: Animated.multiply(visible, gap.interpolate({ inputRange: [12, 44], outputRange: [0, 1], extrapolate: 'clamp' })),
    transform: [
      { translateY: Animated.add(Animated.multiply(gap, 0.5), -STAGE / 2) },
      { scale: gap.interpolate({ inputRange: [0, 50], outputRange: [0, 1], extrapolate: 'clamp' }) },
    ],
  }), [visible, gap]);
  const heights = useMemo(() => pulled.map((value, index) => {
    const samples = Array.from({ length: 13 }, (_, i) => i / 12);
    const wave = loop.interpolate({ inputRange: samples, outputRange: samples.map(t => 0.32 + 0.68 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t - index * 0.5 - Math.PI / 2))) });
    return Animated.add(Animated.multiply(value, Animated.add(1, Animated.multiply(waving, -1))), Animated.multiply(wave, waving));
  }), [pulled, loop, waving]);

  const barHeight = 34 * colors.scale;
  const indicator = <View pointerEvents="none" style={{ position: 'absolute', top, left: 0, right: 0, alignItems: 'center' }}>
    <Animated.View style={[{ height: STAGE, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }, stage]}>
      {message ? <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 14 * colors.scale }}>{message}</Text>
        : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: barHeight * 1.35 }}>
          {heights.map((height, index) => <Animated.View key={index} style={{
            width: 6, height: barHeight, borderRadius: 3, backgroundColor: colors.accent, opacity: lights[index], transform: [{ scaleY: height }],
          }} />)}
        </View>}
    </Animated.View>
  </View>;

  return { onScroll, onScrollBeginDrag, onScrollEndDrag, listStyle, indicator };
}
