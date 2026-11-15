import { uploadInProgress } from '@plyr/next-core/publishing/upload-queue-model';
import type { UploadJobView } from '@plyr/next-core/publishing/upload-queue-model';

export const uploadActivity = $state({ jobs: [] as readonly UploadJobView[] });

export function activeUploadCount(owner: string | null) {
  return uploadActivity.jobs.filter(job => job.owner === owner && uploadInProgress(job.phase)).length;
}
