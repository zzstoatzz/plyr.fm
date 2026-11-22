import { createContext, useCallback, useRef } from 'react';
import { Keyboard, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance, type HostInstance } from 'react-native';

/** Scrolls a field back above the keyboard after it grows under it. */
export type KeepInView = (field: Pick<HostInstance, 'measureInWindow'>) => void;
export const KeepInViewContext = createContext<KeepInView | undefined>(undefined);

/** The scroll view keeps its own keyboard inset; this only follows a field that grows while someone types. */
export function useKeepInView(gap = 16) {
  const scroll = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = event.nativeEvent.contentOffset.y; }, []);
  const keep = useCallback<KeepInView>(field => {
    const keyboard = Keyboard.metrics();
    if (!keyboard) return;
    field.measureInWindow((_x, y, _width, height) => {
      const over = y + height + gap - keyboard.screenY;
      if (over > 0) scroll.current?.scrollTo({ y: offset.current + over, animated: true });
    });
  }, [gap]);
  return { scroll, onScroll, keep };
}
