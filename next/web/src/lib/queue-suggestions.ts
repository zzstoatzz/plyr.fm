import { createQueueSuggestions } from '@plyr/next-core/queue-suggestion-store';
import { api } from './api';

/** One for the session, so the queue's strips outlive the panel that draws them. */
export const queueSuggestions = createQueueSuggestions(api);
