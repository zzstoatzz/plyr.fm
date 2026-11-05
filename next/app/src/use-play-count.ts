import { useCallback, useSyncExternalStore } from 'react';
import { playMetrics } from './play-metrics';

export function usePlayCount(trackId: string, serverCount: number) {
  const subscribe = useCallback((listener: () => void) => playMetrics.subscribe(trackId, listener), [trackId]);
  const snapshot = useCallback(() => Math.max(serverCount, playMetrics.get(trackId) ?? 0), [trackId, serverCount]);
  return useSyncExternalStore(subscribe, snapshot, () => serverCount);
}
