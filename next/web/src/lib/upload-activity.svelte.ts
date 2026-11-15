import type { UploadJobView } from '@plyr/next-core/publishing/upload-queue-model';

export const uploadActivity = $state({ jobs: [] as readonly UploadJobView[] });
