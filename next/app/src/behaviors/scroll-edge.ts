import { createContext, createElement, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

export type Edge = { near: () => boolean; watch: (check: () => void) => () => void };
export const ScrollEdge = createContext<Edge | null>(null);

/**
 * Lets the paged lists inside a scroll view load their next page as its end comes within one and a half
 * screens, the way home's latest tracks do, so no list asks for a "more" press. Spread `props` on the scroll
 * view (calling any handler of your own from yours) and wrap its content in `ScrollEdgeProvider`.
 */
export function useScrollEdge() {
  const metrics = useRef({ height: 0, content: 0, offset: 0 });
  const checks = useRef(new Set<() => void>());
  const notify = useCallback(() => { for (const check of checks.current) check(); }, []);
  const edge = useMemo<Edge>(() => ({
    near() {
      const { height, content, offset } = metrics.current;
      return height > 0 && content > 0 && content - offset - height <= height * 1.5;
    },
    watch(check) {
      checks.current.add(check);
      return () => { checks.current.delete(check); };
    },
  }), []);
  const props = useMemo(() => ({
    scrollEventThrottle: 16,
    onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) { metrics.current.offset = event.nativeEvent.contentOffset.y; notify(); },
    onLayout(event: LayoutChangeEvent) { metrics.current.height = event.nativeEvent.layout.height; notify(); },
    onContentSizeChange(_: number, height: number) { metrics.current.content = height; notify(); },
  }), [notify]);
  return { props, edge };
}

export function ScrollEdgeProvider({ edge, children }: { edge: Edge; children: ReactNode }) {
  return createElement(ScrollEdge.Provider, { value: edge }, children);
}

