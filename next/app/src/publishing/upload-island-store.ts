import { useSyncExternalStore } from 'react';
import type { UploadIsland } from '@plyr/next-core/publishing/upload-island';
import { reportUploadActivity } from './upload-activity';

export type IslandShown = UploadIsland & { key: string; serial: number };

const HOLD_MS = 1600;
let shown: IslandShown | null = null;
let serial = 0;
let hold: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function publish(next: IslandShown | null) {
  shown = next;
  for (const listener of listeners) listener();
}

/** Shows an upload step in the island; a finish holds briefly, then the island folds away. */
export function showUploadIsland(key: string, island: UploadIsland | undefined) {
  if (!island) return;
  reportUploadActivity(key, island);
  clearTimeout(hold);
  publish({ ...island, key, serial: ++serial });
  if (island.phase === 'active') return;
  const finished = serial;
  hold = setTimeout(() => { if (shown?.serial === finished) publish(null); }, HOLD_MS);
}

/** Folds the island away when it is showing an upload that left the queue. */
export function hideUploadIsland(key: string) {
  if (shown?.key !== key) return;
  clearTimeout(hold);
  publish(null);
}

export function useUploadIsland() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => shown, () => shown);
}
