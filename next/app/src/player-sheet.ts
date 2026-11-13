import { useSyncExternalStore } from 'react';
import { Animated } from 'react-native';

export interface Rect { x: number; y: number; width: number; height: number }
export type Measurable = { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void };

const translation = new Animated.Value(0);
const listeners = new Set<() => void>();
let flying = false;
let present = false;

export const playerSheet = {
  translation,
  value: 0,
  dockTop: undefined as number | undefined,
  dragging: false,
  release: undefined as { open: boolean; velocity: number } | undefined,
  settle: undefined as ((open: boolean, velocity: number) => void) | undefined,
  dock: { art: null, title: null } as Record<'art' | 'title', Measurable | null>,
  instant: false,
  leaving: false,
  opened: undefined as (() => void) | undefined,
  /** Opens now playing from outside the dock (the radio grid); the dock sets it while it is mounted. */
  expand: undefined as (() => void) | undefined,
  get present() { return present; },
  show(instant = false) { if (!present) playerSheet.instant = instant; setPresent(true); },
  hide() { playerSheet.leaving = false; setPresent(false); },
};

function setPresent(next: boolean) {
  if (present === next) return;
  present = next;
  for (const listener of listeners) listener();
}

export function useSheetPresent() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => present, () => false);
}
translation.addListener(({ value }) => { playerSheet.value = value; });

export function setFlying(next: boolean) {
  if (flying === next) return;
  flying = next;
  for (const listener of listeners) listener();
}

export function useFlying() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => flying, () => false);
}

export function measure(target: Measurable | null): Promise<Rect | undefined> {
  return new Promise(resolve => {
    if (!target) { resolve(undefined); return; }
    target.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : undefined));
  });
}
