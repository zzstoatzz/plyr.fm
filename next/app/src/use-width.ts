import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/** A view's current width: pass `ref` and `onLayout` to the view. */
export function useWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);
  const ref = useCallback((_: unknown) => undefined, []);
  return { width, ref, onLayout };
}
