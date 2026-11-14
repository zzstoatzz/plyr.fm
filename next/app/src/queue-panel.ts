import { useSyncExternalStore } from 'react';
import { readLocal, writeLocal } from './storage';

/** Whether the desktop queue panel is open. It stays as you left it between visits, like prod's. */
const key = 'plyr-next:queue-panel';
let open = readLocal(key) === '1';
const listeners = new Set<() => void>();

export function setQueuePanel(next: boolean) {
  if (next === open) return;
  open = next;
  writeLocal(key, next ? '1' : '0');
  for (const listener of listeners) listener();
}

export const toggleQueuePanel = () => setQueuePanel(!open);

export function useQueuePanel(): boolean {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => open, () => false);
}
