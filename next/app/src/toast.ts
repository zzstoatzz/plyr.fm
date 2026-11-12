import type { Href } from 'expo-router';
import { useSyncExternalStore } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export interface ToastAction { label: string; href: Href }
export interface Toast { id: number; message: string; type: ToastType; action?: ToastAction; leaving: boolean }

const leave = 600;
const limit = 3;
let toasts: Toast[] = [];
let serial = 0;
const listeners = new Set<() => void>();
function publish(next: Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

function add(message: string, type: ToastType = 'info', duration = 3000, action?: ToastAction) {
  const id = ++serial;
  publish([{ id, message, type, action, leaving: false }, ...toasts]);
  for (const extra of toasts.filter(item => !item.leaving).slice(limit)) dismiss(extra.id);
  if (duration > 0) setTimeout(() => dismiss(id), duration);
  return id;
}

function dismiss(id: number) {
  if (!toasts.some(item => item.id === id && !item.leaving)) return;
  publish(toasts.map(item => item.id === id ? { ...item, leaving: true } : item));
  setTimeout(() => publish(toasts.filter(item => item.id !== id)), leave);
}

function update(id: number, message: string, type?: ToastType) {
  publish(toasts.map(item => item.id === id ? { ...item, message, type: type ?? item.type } : item));
}

export const toast = {
  add, dismiss, update, leave,
  success: (message: string, duration = 3000, action?: ToastAction) => add(message, 'success', duration, action),
  error: (message: string, duration = 5000) => add(message, 'error', duration),
  info: (message: string, duration = 3000, action?: ToastAction) => add(message, 'info', duration, action),
  warning: (message: string, duration = 4000, action?: ToastAction) => add(message, 'warning', duration, action),
};

export function useToasts() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => toasts, () => toasts);
}
