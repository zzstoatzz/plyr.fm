import type { Href } from 'expo-router';
import { useSyncExternalStore } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export interface ToastAction { label: string; href: Href }
export interface Toast { id: number; message: string; type: ToastType; action?: ToastAction; key?: string; leaving: boolean }

const leave = 600;
const limit = 3;
let toasts: Toast[] = [];
let serial = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
function publish(next: Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

function expire(id: number, duration: number) {
  clearTimeout(timers.get(id));
  if (duration > 0) timers.set(id, setTimeout(() => dismiss(id), duration));
}

/** A toast with a `key` replaces the live toast with the same key instead of stacking under it. */
function add(message: string, type: ToastType = 'info', duration = 3000, action?: ToastAction, key?: string) {
  const same = key === undefined ? undefined : toasts.find(item => item.key === key && !item.leaving);
  if (same) {
    publish(toasts.map(item => item === same ? { ...item, message, type, action } : item));
    expire(same.id, duration);
    return same.id;
  }
  const id = ++serial;
  publish([{ id, message, type, action, key, leaving: false }, ...toasts]);
  for (const extra of toasts.filter(item => !item.leaving).slice(limit)) dismiss(extra.id);
  expire(id, duration);
  return id;
}

function dismiss(id: number) {
  if (!toasts.some(item => item.id === id && !item.leaving)) return;
  clearTimeout(timers.get(id));
  timers.delete(id);
  publish(toasts.map(item => item.id === id ? { ...item, leaving: true } : item));
  setTimeout(() => publish(toasts.filter(item => item.id !== id)), leave);
}

function dismissKey(key: string) {
  for (const item of toasts.filter(item => item.key === key)) dismiss(item.id);
}

function update(id: number, message: string, type?: ToastType) {
  publish(toasts.map(item => item.id === id ? { ...item, message, type: type ?? item.type } : item));
}

export const toast = {
  add, dismiss, dismissKey, update, leave,
  success: (message: string, duration = 3000, action?: ToastAction) => add(message, 'success', duration, action),
  error: (message: string, duration = 5000) => add(message, 'error', duration),
  info: (message: string, duration = 3000, action?: ToastAction) => add(message, 'info', duration, action),
  warning: (message: string, duration = 4000, action?: ToastAction) => add(message, 'warning', duration, action),
};

export function useToasts() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => toasts, () => toasts);
}
