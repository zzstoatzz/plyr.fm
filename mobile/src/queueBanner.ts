import type { SFSymbol } from "expo-symbols";
import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

/** How long the banner stays; the web's queue toasts use the same. */
export const BANNER_MS = 1800;

export type Banner = { id: number; message: string; symbol: SFSymbol };

let current: Banner | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let count = 0;
const listeners = new Set<() => void>();

function set(next: Banner | null) {
  current = next;
  for (const listener of listeners) listener();
}

/** Says a track went into the queue. One at a time: a new one replaces the one showing. VoiceOver hears it. */
export function showQueueBanner(message: string, symbol: SFSymbol) {
  if (timer) clearTimeout(timer);
  set({ id: ++count, message, symbol });
  AccessibilityInfo.announceForAccessibility(message);
  timer = setTimeout(() => set(null), BANNER_MS);
}

export function dismissQueueBanner() {
  if (timer) clearTimeout(timer);
  set(null);
}

export function useQueueBanner(): Banner | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
