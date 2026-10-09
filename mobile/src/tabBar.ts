import { useSyncExternalStore } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/** How far a scroll has to travel in one direction before the tab bar follows it. */
const TRAVEL = 24;

let hidden = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === hidden) return;
  hidden = next;
  for (const listener of listeners) listener();
}

/** Brings the tab bar back, for a screen that has just appeared and may have nothing to scroll. */
export const showTabBar = () => set(false);

/** Whether a list has been scrolled down, away from the tab bar. */
export function useTabBarHidden(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => hidden,
  );
}

/** An `onScroll` for a list under the tab bar: scrolling down puts the tab bar away, scrolling up or reaching the top brings it back. */
export function tabBarScroll(): (event: NativeSyntheticEvent<NativeScrollEvent>) => void {
  let anchor = 0;
  return ({ nativeEvent }) => {
    const y = nativeEvent.contentOffset.y + nativeEvent.contentInset.top;
    const end = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height;
    if (y <= 0) {
      anchor = 0;
      return set(false);
    }
    if (y >= end) return;
    if (Math.abs(y - anchor) < TRAVEL) return;
    set(y > anchor);
    anchor = y;
  };
}
