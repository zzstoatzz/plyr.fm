import { MAX_AUDIO_BYTES } from './track-audio.ts';
import { audioFormat, MAX_SERVICE_AUDIO_BYTES, type UploadProcessing, type UploadStatus } from './upload-model.ts';

/** Lossless or browser-unfriendly sources get an MP3 playback copy, as production does; the original stays downloadable. */
// Ogg and Opus too: iOS can't play either, so they get an MP3 copy like the lossless formats.
const PROCESSED = new Set(['wav', 'flac', 'aif', 'aiff', 'webm', 'ogg', 'opus']);
const MP3_BYTES_PER_SECOND = 40_000;
const MIB = 1_048_576;

export type UploadRoute = { kind: 'pds' } | { kind: 'service'; processing?: UploadProcessing };
export type UploadPhase = 'waiting' | 'uploading' | 'processing' | 'publishing' | 'done' | 'failed';
export type UploadJobView = { id: string; owner: string; title: string; phase: UploadPhase; progress?: number; uri?: string; error?: string };

export function fileType(name: string) {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

export function outputBudget(sizeBytes: number, type: string, duration?: number) {
  const ceiling = 2 * MAX_SERVICE_AUDIO_BYTES - sizeBytes;
  const estimate = duration && Number.isFinite(duration) && duration > 0
    ? Math.ceil(duration * MP3_BYTES_PER_SECOND * 1.1) + 4 * MIB
    : type === 'webm' || type === 'ogg' || type === 'opus' ? sizeBytes * 4 : sizeBytes + 4 * MIB;
  return Math.max(MIB, Math.min(ceiling, estimate));
}

/** Where the bytes go: small playable audio to the account's PDS, the rest through plyr storage. */
export function uploadRoute(file: { name: string; type: string; size: number }, duration?: number): UploadRoute {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('choose a nonempty audio file.');
  if (file.size > MAX_SERVICE_AUDIO_BYTES) throw new Error('audio files are limited to 1.5 GiB.');
  const type = fileType(file.name);
  if (PROCESSED.has(type)) {
    audioFormat(file.name, file.type, true);
    return { kind: 'service', processing: { recipe: 'mp3-320k-44100-v1', outputBudget: outputBudget(file.size, type, duration) } };
  }
  audioFormat(file.name, file.type);
  return file.size > MAX_AUDIO_BYTES ? { kind: 'service' } : { kind: 'pds' };
}

export function needsPlyrStorage(file: { name: string; size: number }) {
  return PROCESSED.has(fileType(file.name)) || file.size > MAX_AUDIO_BYTES;
}

/** One processing poll step: keep waiting, publish, or stop with the reason. */
export function processingStep(status: UploadStatus): 'wait' | 'publish' | 'retry' | 'stop' {
  if (status.state === 'complete' || status.state === 'published') return 'publish';
  if (status.state !== 'processing') return 'stop';
  if (status.processingFailure === 'output_budget_exceeded') return 'stop';
  return status.recoveryRequired ? 'retry' : 'wait';
}

export type Genre = { name: string; confidence: number };

/** Production's rule: genres within half the top score, at most five, added after the artist's own tags. */
export function genreTags(current: readonly string[], genres: readonly Genre[]) {
  const top = genres[0]?.confidence ?? 0;
  const suggested = genres.filter(genre => genre.confidence >= top * 0.5).slice(0, 5).map(genre => genre.name);
  return [...new Set([...current, ...suggested])].slice(0, Math.max(20, current.length));
}

/** Network drops and server hiccups are worth another try; refusals are not. */
export function transient(failure: unknown) {
  if (failure instanceof TypeError) return true;
  const status = failure && typeof failure === 'object' && 'status' in failure && typeof failure.status === 'number' ? failure.status : undefined;
  return status !== undefined && (status === 408 || status === 429 || status >= 500);
}

export function retryDelay(attempt: number) {
  return Math.min(30_000, 2_000 * 2 ** attempt);
}

export function jobLine(job: UploadJobView): string {
  const name = `"${job.title}"`;
  switch (job.phase) {
    case 'waiting': return `${name} is next…`;
    case 'uploading': return job.progress === undefined ? `uploading ${name}…` : `uploading ${name} ${Math.min(100, Math.floor(job.progress * 100))}%`;
    case 'processing': return `converting ${name} to mp3…`;
    case 'publishing': return `publishing ${name}…`;
    case 'done': return `${name} uploaded`;
    case 'failed': return job.error ? `${name} didn't upload: ${job.error}` : `${name} didn't upload`;
  }
}

/** The canonical audio type for a picked file, whatever its picker called it. */
export function canonicalAudioType(file: { name: string; type: string; size: number }) {
  const route = uploadRoute(file);
  return audioFormat(file.name, file.type, route.kind === 'service' && !!route.processing).contentType;
}
