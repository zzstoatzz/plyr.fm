import type { UploadJobView } from '$core/publishing/upload-queue-model';

export const uploadActivity = $state({ jobs: [] as readonly UploadJobView[] });
