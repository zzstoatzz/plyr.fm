import { createClosing } from '@plyr/next-core/access/close';
import { AUDIO_SPACE_TYPE, NSID, SPACE_MANAGING_APP } from '../auth-config.ts';

export const { spaceFor, spaceRecordUri, managedPolicy, requireManagedSpace, closedRecords, reopenedRecord } = createClosing({ NSID, AUDIO_SPACE_TYPE, SPACE_MANAGING_APP });
