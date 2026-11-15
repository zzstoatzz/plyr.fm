import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { createTrackComments, type Snapshot } from '@plyr/next-core/track-comments';
import { api } from './api-client';
import { getAuth } from './auth-state';
import { createPds } from './pds';

const { subscribe, snapshot, hasLoaded, loadComments, addComment, removeComment } = createTrackComments({ api, getAuth, createPds });
export { addComment, removeComment };

export function useTrackComments(id: string | undefined): Snapshot & { retry: () => void } {
  const listen = useCallback((listener: () => void) => id ? subscribe(id, listener) : () => {}, [id]);
  const current = useSyncExternalStore(listen, () => snapshot(id));
  useEffect(() => { if (id && !hasLoaded(id)) loadComments(id); }, [id]);
  const retry = useCallback(() => { if (id) loadComments(id); }, [id]);
  return { ...current, retry };
}
