import { jobLine, type UploadJobView } from './upload-queue-model.ts';

/** What the upload island shows: a short word or two beside the camera, plus the full sentence for VoiceOver. */
export type UploadIsland = { phase: 'active' | 'done' | 'failed'; summary: string; progress?: number; announce: string };

export function uploadIsland(job: Pick<UploadJobView, 'title' | 'phase' | 'progress' | 'error'>): UploadIsland | undefined {
  const announce = jobLine({ id: '', owner: '', ...job });
  switch (job.phase) {
    case 'waiting': return { phase: 'active', summary: 'up next', announce };
    case 'uploading': return job.progress === undefined ? { phase: 'active', summary: 'uploading', announce }
      : { phase: 'active', summary: `${Math.min(100, Math.floor(job.progress * 100))}%`, progress: Math.min(1, job.progress), announce };
    case 'processing': return { phase: 'active', summary: 'to mp3', announce };
    case 'publishing': return { phase: 'active', summary: 'publishing', announce };
    case 'retrying': return { phase: 'active', summary: 'retrying', announce };
    case 'awaiting-publication': return { phase: 'active', summary: 'almost', announce };
    case 'done': return { phase: 'done', summary: 'uploaded', announce };
    case 'failed': return { phase: 'failed', summary: 'failed', announce };
  }
}

/** The job the island follows: the one moving now, else whichever just finished. */
export function islandJob<T extends Pick<UploadJobView, 'phase'>>(jobs: readonly T[], changed: T): T {
  const moving = jobs.find(job => job.phase !== 'waiting' && job.phase !== 'done' && job.phase !== 'failed' && job.phase !== 'awaiting-publication');
  return changed.phase === 'done' || changed.phase === 'failed' ? changed : moving ?? changed;
}
