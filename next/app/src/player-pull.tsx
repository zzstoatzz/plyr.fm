import { useRef, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { GestureDetector, GestureHandlerRootView, useNativeGesture, usePanGesture } from 'react-native-gesture-handler';

export { GestureDetector as PullDetector };

export interface PullTarget { begin(): void; update(dy: number, pointers: number): void; end(velocity: number): void }

/**
 * The now-playing pull on native: a pan recognized together with the scroll
 * view's own gesture, so scrolling the details and pulling the sheet down from
 * their top are one continuous drag. Horizontal drags (the seek slider) fail it.
 */
export function usePlayerPull(enabled: boolean, target: PullTarget) {
  const latest = useRef(target);
  latest.current = target;
  const scroll = useNativeGesture({});
  const pan = usePanGesture({
    enabled, runOnJS: true, simultaneousWith: scroll,
    activeOffsetY: [-8, 8], failOffsetX: [-16, 16],
    onBegin: () => latest.current.begin(),
    onUpdate: event => latest.current.update(event.translationY, event.numberOfPointers),
    onDeactivate: event => latest.current.end(event.velocityY),
  });
  return { pan, scroll };
}

export function PullRoot({ children }: { children: ReactNode }) {
  return <GestureHandlerRootView style={styles.root}>{children}</GestureHandlerRootView>;
}

const styles = StyleSheet.create({ root: { flex: 1 } });
