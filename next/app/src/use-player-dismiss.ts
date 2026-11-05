import { useEffect, useRef } from 'react';
import { Animated, PanResponder, Platform } from 'react-native';

export function usePlayerDismiss(enabled: boolean, width: number, height: number, close: () => void) {
  const translation = useRef(new Animated.Value(0)).current;
  const latest = useRef({ enabled, height, close });
  latest.current = { enabled, height, close };
  const closing = useRef(false);
  const generation = useRef(0);
  const active = useRef<number | null>(null);
  const native = Platform.OS !== 'web';
  const snapBack = () => {
    active.current = null;
    Animated.spring(translation, { toValue: 0, stiffness: 280, damping: 24, mass: 1, useNativeDriver: native }).start();
  };
  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) => latest.current.enabled && !closing.current && gesture.numberActiveTouches === 1 &&
      gesture.dy > 10 && gesture.dy > Math.abs(gesture.dx) * 1.5,
    onPanResponderGrant: () => { active.current = generation.current; translation.stopAnimation(); },
    onPanResponderStart: (_, gesture) => { if (gesture.numberActiveTouches !== 1) snapBack(); },
    onPanResponderMove: (_, gesture) => {
      if (active.current !== generation.current) return;
      if (gesture.numberActiveTouches !== 1) { snapBack(); return; }
      translation.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_, gesture) => {
      if (active.current !== generation.current) return;
      active.current = null;
      const downward = gesture.dy > Math.abs(gesture.dx) * 1.2;
      const dismiss = downward && (gesture.dy >= Math.min(120, latest.current.height * 0.16) || (gesture.dy >= 48 && gesture.vy >= 0.8));
      if (dismiss) {
        closing.current = true;
        const request = generation.current;
        Animated.timing(translation, { toValue: latest.current.height, duration: 170, useNativeDriver: native }).start(({ finished }) => {
          if (finished && request === generation.current) latest.current.close();
        });
      } else snapBack();
    },
    onPanResponderTerminate: snapBack,
    onPanResponderTerminationRequest: () => true
  })).current;
  useEffect(() => {
    generation.current++;
    active.current = null;
    closing.current = false;
    translation.stopAnimation();
    translation.setValue(0);
  }, [enabled, width, height, translation]);
  useEffect(() => () => { generation.current++; active.current = null; translation.stopAnimation(); }, [translation]);
  return { translation, panHandlers: enabled ? responder.panHandlers : {} };
}
