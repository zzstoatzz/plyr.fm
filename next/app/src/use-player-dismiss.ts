import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, type ScrollEvent } from 'react-native';
import { playerSheet } from './player-sheet';

export function usePlayerDismiss(enabled: boolean, width: number, height: number, close: () => void, still = false, rest = height, present = true) {
  const translation = playerSheet.translation;
  const latest = useRef({ enabled, rest, close, still });
  latest.current = { enabled, rest, close, still };
  const closing = useRef(false);
  const blocked = useRef(false);
  const offset = useRef(0);
  const [atTop, setAtTop] = useState(true);
  const [dragging, setDragging] = useState(false);
  // Native only: true while the sheet sits open with nothing moving it, so the open state renders as plain styles.
  const [resting, setResting] = useState(false);
  const markResting = setResting;
  const generation = useRef(0);
  const active = useRef<number | null>(null);
  // Native pulls come from a gesture-handler pan running beside the scroll view: it moves the sheet only once the content is at its top.
  const pullFrom = useRef<number | null>(null);
  const firstMove = useRef(true);
  const fromContent = useRef(false);
  const pulled = useRef(0);
  const scrolled = useRef((_event: ScrollEvent) => {});
  // JS-driven on every platform: React commits write Animated props from the JS value, which a native-driven spring leaves
  // stale, so a re-render mid-animation (a playback tick) snapped the sheet's content to its closed state.
  const spring = (toValue: number, velocity: number) => Animated.spring(translation, { toValue, velocity, stiffness: 1000, damping: 62, mass: 1,
    overshootClamping: true, restDisplacementThreshold: toValue ? 4 : 1.5, restSpeedThreshold: toValue ? 40 : 1.5, useNativeDriver: false });
  const exit = (then: () => void, velocity = 0) => {
    if (closing.current) return;
    closing.current = true;
    active.current = null;
    markResting(false);
    if (latest.current.still) { then(); return; }
    const request = generation.current;
    // The close finishes even if its spring is interrupted or never completes (seen once in the simulator: the sheet sat mid-way).
    // A reopen or a new open bumps the generation or clears closing, so only a close still in progress ends here.
    let done = false;
    const finish = () => {
      if (done || request !== generation.current || !closing.current) return;
      done = true;
      translation.stopAnimation();
      translation.setValue(latest.current.rest);
      then();
    };
    spring(latest.current.rest, velocity).start(finish);
    setTimeout(finish, 900);
  };
  const settle = (open: boolean, velocity = 0) => {
    if (!open) { exit(latest.current.close, velocity); return; }
    closing.current = false;
    markResting(false);
    const request = generation.current;
    spring(0, velocity).start(({ finished }) => {
      if (!finished || request !== generation.current) return;
      translation.setValue(0);
      markResting(true);
    });
  };
  const api = useRef({ exit, settle });
  api.current = { exit, settle };
  const snapBack = () => {
    active.current = null;
    setDragging(false);
    const request = generation.current;
    Animated.spring(translation, { toValue: 0, stiffness: 280, damping: 24, mass: 1, useNativeDriver: false }).start(({ finished }) => {
      if (finished && request === generation.current && !closing.current) { translation.setValue(0); markResting(true); }
    });
  };
  const sized = useRef({ width, height });
  useLayoutEffect(() => {
    generation.current++;
    active.current = null;
    closing.current = false;
    setDragging(false);
    pullFrom.current = null;
    if (!present) { translation.stopAnimation(); translation.setValue(rest); return; }
    markResting(false);
    if (still) { translation.stopAnimation(); translation.setValue(0); markResting(true); }
    else { translation.setValue(rest); api.current.settle(true); }
  }, [present, translation]);
  useEffect(() => {
    if (sized.current.width === width && sized.current.height === height) return;
    sized.current = { width, height };
    generation.current++;
    active.current = null;
    closing.current = false;
    setDragging(false);
    translation.stopAnimation();
    translation.setValue(present ? 0 : rest);
    markResting(present);
  }, [enabled, width, height, translation]);
  useEffect(() => () => { generation.current++; active.current = null; translation.stopAnimation(); }, [translation]);
  const guard = { onStartShouldSetResponderCapture: () => { blocked.current = true; return false; } };
  const onScroll = (event: ScrollEvent) => {
    const wasAtTop = offset.current <= 1;
    offset.current = Math.max(0, event.nativeEvent.contentOffset.y);
    if (wasAtTop !== (offset.current <= 1)) setAtTop(offset.current <= 1);
    scrolled.current(event);
  };
  // A drag that starts in the header pulls at once; one that starts in the content pulls from the moment the content reaches its top.
  const pull = {
    begin() { firstMove.current = true; },
    update(dy: number, pointers: number) {
      const first = firstMove.current;
      firstMove.current = false;
      if (!latest.current.enabled || closing.current || blocked.current) return;
      if (pointers > 1) { if (pullFrom.current !== null) { pullFrom.current = null; snapBack(); } return; }
      if (pullFrom.current === null) {
        if (dy <= 0 || fromContent.current && offset.current > 0) return;
        // A pull from rest counts the recognizer's activation distance; one that follows a scroll starts where the content met its top.
        pullFrom.current = first ? 0 : dy;
        active.current = generation.current;
        markResting(false);
        setDragging(true);
        translation.stopAnimation();
      }
      pulled.current = Math.min(latest.current.rest, Math.max(0, dy - pullFrom.current));
      translation.setValue(pulled.current);
    },
    end(velocity: number) {
      if (pullFrom.current === null) return;
      pullFrom.current = null;
      if (active.current !== generation.current) return;
      const distance = pulled.current;
      if (velocity > -300 && (distance >= Math.min(80, height * 0.1) || distance >= 16 && velocity >= 300)) {
        setDragging(false);
        api.current.exit(latest.current.close, Math.max(0, velocity));
      } else snapBack();
    },
  };
  return {
    translation, scrolled,
    dragging, resting, atTop, exit,
    pull,
    panelStartHandlers: {
      onStartShouldSetResponderCapture: () => { blocked.current = false; fromContent.current = false; return false; }
    },
    contentStartHandlers: {
      onStartShouldSetResponderCapture: () => { fromContent.current = true; return false; }
    },
    // On native an active pull cancels a press on its own, so only the seek slider keeps a drag to itself.
    protectSlider: guard,
    scrollProps: { onScroll, bounces: !atTop },
  };
}
