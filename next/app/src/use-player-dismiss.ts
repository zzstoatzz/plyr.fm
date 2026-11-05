import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, type ScrollEvent } from 'react-native';

export function usePlayerDismiss(enabled: boolean, width: number, height: number, close: () => void) {
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const panelRef = useCallback((node: unknown) => {
    if (Platform.OS === 'web') setPanel(node instanceof HTMLElement ? node : null);
  }, []);
  const directionalTouch = Platform.OS === 'web' && typeof CSS !== 'undefined' && CSS.supports('touch-action', 'pan-x pan-down');
  const translation = useRef(new Animated.Value(0)).current;
  const latest = useRef({ enabled, height, close });
  latest.current = { enabled, height, close };
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
      translation.setValue(Math.max(0, gesture.dy + acquiredAt.current.dy));
    },
    onPanResponderRelease: (_, gesture) => {
      if (active.current !== generation.current) return;
      active.current = null;
      const dy = gesture.dy + acquiredAt.current.dy;
      const dx = gesture.dx + acquiredAt.current.dx;
      const downward = dy > Math.abs(dx) * 1.2;
      const dismiss = downward && (dy >= Math.min(120, latest.current.height * 0.16) || (dy >= 48 && gesture.vy >= 0.8));
      if (dismiss) {
        closing.current = true;
        const request = generation.current;
        Animated.timing(translation, { toValue: latest.current.height, duration: 170, useNativeDriver: native }).start(({ finished }) => {
          if (finished && request === generation.current) latest.current.close();
        });
      } else snapBack();
    },
    onPanResponderTerminate: snapBack,
    onPanResponderTerminationRequest: () => active.current === null
  })).current;
  useEffect(() => {
    generation.current++;
    active.current = null;
    closing.current = false;
    setDragging(false);
    translation.stopAnimation();
    translation.setValue(0);
  }, [enabled, width, height, translation]);
  useEffect(() => () => { generation.current++; active.current = null; translation.stopAnimation(); }, [translation]);
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
  return {
    translation, dragging, atTop, directionalTouch,
    panelRef,
    panHandlers: enabled ? responder.panHandlers : {},
    contentStartHandlers: {
      onStartShouldSetResponderCapture: () => { canPull.current = offset.current <= 1; return false; }
    },
    protect: {
      onStartShouldSetResponderCapture: () => { blocked.current = true; return false; }
    },
    onScroll: (event: ScrollEvent) => {
      const wasAtTop = offset.current <= 1;
      offset.current = Math.max(0, event.nativeEvent.contentOffset.y);
      if (wasAtTop !== (offset.current <= 1)) setAtTop(offset.current <= 1);
    }
  };
}
