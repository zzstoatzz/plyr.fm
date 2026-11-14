import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

// react-native-web's onLayout misses width changes that come from a sibling resizing (the docked queue panel), so watch the element.
export function useWidth() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);
  const ref = useCallback((view: unknown) => {
    observer.current?.disconnect();
    observer.current = null;
    const node = view as HTMLElement | null;
    if (!node) return;
    observer.current = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.current.observe(node);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return { width, ref, onLayout };
}
