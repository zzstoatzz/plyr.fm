import { useSyncExternalStore } from 'react';
import { createQueueSuggestions } from '@plyr/next-core/queue-suggestion-store';
import { api } from './api-client';

/** One for the session, so the queue's strips outlive the sheet that draws them. */
export const queueSuggestions = createQueueSuggestions(api);

export function useQueueSuggestions() {
  return useSyncExternalStore(queueSuggestions.subscribe, queueSuggestions.snapshot, queueSuggestions.snapshot);
}
