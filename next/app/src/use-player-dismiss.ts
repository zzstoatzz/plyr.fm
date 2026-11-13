import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, type ScrollEvent } from 'react-native';
import { playerSheet } from './player-sheet';

export function usePlayerDismiss(enabled: boolean, width: number, height: number, close: () => void, still = false, rest = height, present = true) {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const panelRef = useCallback((node: unknown) => {
    if (Platform.OS === 'web') setPanel(node instanceof HTMLElement ? node : null);
  }, []);
  const directionalTouch = Platform.OS === 'web' && typeof CSS !== 'undefined' && CSS.supports('touch-action', 'pan-x pan-down');
  const translation = playerSheet.translation;
  const latest = useRef({ enabled, rest, close, still });
  latest.current = { enabled, rest, close, still };
  const closing = useRef(false);
  const blocked = useRef(false);
  const canPull = useRef(true);
  const offset = useRef(0);
  const [atTop, setAtTop] = useState(true);
  const [dragging, setDragging] = useState(false);
  const generation = useRef(0);
  const acquiredAt = useRef({ dx: 0, dy: 0 });
  const active = useRef<number | null>(null);
  const native = Platform.OS !== 'web';
  // Native pulls come from a gesture-handler pan running beside the scroll view: it moves the sheet only once the content is at its top.
  const pullFrom = useRef<number | null>(null);
  const firstMove = useRef(true);
  const fromContent = useRef(false);
  const pulled = useRef(0);
  const scrolled = useRef((_event: ScrollEvent) => {});
  const spring = (toValue: number, velocity: number) => Animated.spring(translation, { toValue, velocity, stiffness: 1000, damping: 62, mass: 1,
    overshootClamping: true, restDisplacementThreshold: toValue ? 4 : 1.5, restSpeedThreshold: toValue ? 40 : 1.5, useNativeDriver: native });
  const exit = (then: () => void, velocity = 0) => {
    if (closing.current) return;
    closing.current = true;
    active.current = null;
    if (latest.current.still) { then(); return; }
    const request = generation.current;
    spring(latest.current.rest, velocity).start(({ finished }) => { if (finished && request === generation.current) then(); });
  };
  const settle = (open: boolean, velocity = 0) => {
    if (!open) { exit(latest.current.close, velocity); return; }
    closing.current = false;
    const request = generation.current;
    spring(0, velocity).start(({ finished }) => { if (finished && request === generation.current) playerSheet.opened?.(); });
  };
  const api = useRef({ exit, settle });
  api.current = { exit, settle };
  const snapBack = () => {
    active.current = null;
    setDragging(false);
    Animated.spring(translation, { toValue: 0, stiffness: 280, damping: 24, mass: 1, useNativeDriver: native }).start();
  };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: (_, gesture) => {
      blocked.current = gesture.numberActiveTouches > 1;
      canPull.current = true;
      if (blocked.current) snapBack();
      return false;
    },
    onMoveShouldSetPanResponderCapture: (_, gesture) => {
      if (gesture.dy < -10 || Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) >= Math.abs(gesture.dy)) canPull.current = false;
      const acquire = latest.current.enabled && !closing.current && !blocked.current && canPull.current && gesture.numberActiveTouches === 1 &&
        gesture.dy > 10 && gesture.dy > Math.abs(gesture.dx) * 1.5;
      if (acquire) acquiredAt.current = { dx: gesture.dx, dy: gesture.dy };
      return acquire;
    },
    onPanResponderGrant: () => { active.current = generation.current; setDragging(true); translation.stopAnimation(); },
    onPanResponderStart: (_, gesture) => { if (gesture.numberActiveTouches !== 1) snapBack(); },
    onPanResponderMove: (_, gesture) => {
      if (active.current !== generation.current) return;
      if (gesture.numberActiveTouches !== 1) { snapBack(); return; }
      translation.setValue(Math.min(latest.current.rest, Math.max(0, gesture.dy + acquiredAt.current.dy)));
    },
    onPanResponderRelease: (_, gesture) => {
      if (active.current !== generation.current) return;
      active.current = null;
      const dy = gesture.dy + acquiredAt.current.dy;
      const dx = gesture.dx + acquiredAt.current.dx;
      const downward = dy > Math.abs(dx) * 1.2;
      const dismiss = downward && (dy >= Math.min(120, height * 0.16) || dy >= 48 && gesture.vy >= 0.8);
      if (dismiss) api.current.exit(latest.current.close, gesture.vy * 1000);
      else snapBack();
    },
    onPanResponderTerminate: snapBack,
    onPanResponderTerminationRequest: () => active.current === null
  })).current;
  const sized = useRef({ width, height });
  useLayoutEffect(() => {
    generation.current++;
    active.current = null;
    closing.current = false;
    setDragging(false);
    pullFrom.current = null;
    if (!present) { translation.stopAnimation(); translation.setValue(rest); return; }
    if (still || playerSheet.instant) { playerSheet.instant = false; translation.stopAnimation(); translation.setValue(0); playerSheet.opened?.(); }
    else if (playerSheet.release) { const { open, velocity } = playerSheet.release; playerSheet.release = undefined; api.current.settle(open, velocity); }
    else if (!playerSheet.dragging) { translation.setValue(rest); api.current.settle(true); }
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
  }, [enabled, width, height, translation]);
  useEffect(() => {
    playerSheet.settle = (open, velocity) => api.current.settle(open, velocity);
    return () => { playerSheet.settle = undefined; generation.current++; active.current = null; translation.stopAnimation(); };
  }, [translation]);
  useEffect(() => {
    if (!panel || !enabled || directionalTouch) return;
    let start: { x: number; y: number } | null = null;
    const begin = (event: TouchEvent) => {
      start = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    };
    const move = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1 || blocked.current || !canPull.current) return;
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (dy < -10 || Math.abs(dx) > 10 && Math.abs(dx) >= Math.abs(dy)) canPull.current = false;
      if (canPull.current && dy > 0 && dy > Math.abs(dx) * 1.5 && event.cancelable) event.preventDefault();
    };
    const end = () => { start = null; };
    panel.addEventListener('touchstart', begin, { capture: true, passive: true });
    panel.addEventListener('touchmove', move, { capture: true, passive: false });
    panel.addEventListener('touchend', end, true);
    panel.addEventListener('touchcancel', end, true);
    return () => {
      panel.removeEventListener('touchstart', begin, true);
      panel.removeEventListener('touchmove', move, true);
      panel.removeEventListener('touchend', end, true);
      panel.removeEventListener('touchcancel', end, true);
    };
  }, [panel, enabled, directionalTouch]);
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
    dragging, atTop, directionalTouch, exit,
    panelRef,
    pull,
    panHandlers: enabled && !native ? responder.panHandlers : {},
    panelStartHandlers: native ? {
      onStartShouldSetResponderCapture: () => { blocked.current = false; fromContent.current = false; return false; }
    } : {},
    contentStartHandlers: {
      onStartShouldSetResponderCapture: () => { canPull.current = offset.current <= 1; fromContent.current = true; return false; }
    },
    // On native an active pull cancels a press on its own, so only the seek slider keeps a drag to itself.
    protect: native ? {} : guard,
    protectSlider: guard,
    scrollProps: { onScroll, ...(native ? { bounces: !atTop } : {}) },
  };
}
