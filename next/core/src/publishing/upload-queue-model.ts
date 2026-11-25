import { AUDIO_CONTAINERS, audioRoute, containerFromContentType, containerFromFileType, type AudioContainer, type AudioFormat } from '../audio-format.ts';
import { MAX_AUDIO_BYTES } from './track-audio.ts';
import { claimedContainer, MAX_SERVICE_AUDIO_BYTES, PUBLIC_AUDIO_FORMATS, type UploadProcessing, type UploadStatus } from './upload-model.ts';
const MP3_BYTES_PER_SECOND = 40_000;
const MIB = 1_048_576;

export type UploadRoute = { kind: 'pds' } | { kind: 'service'; processing?: UploadProcessing };
export type UploadPhase = 'waiting' | 'uploading' | 'processing' | 'publishing' | 'retrying' | 'awaiting-publication' | 'done' | 'failed';
export type UploadJobView = { id: string; draftId?: string; owner: string; title: string; phase: UploadPhase; progress?: number; uri?: string; error?: string };

export function uploadInProgress(phase: UploadPhase) {
  return phase === 'waiting' || phase === 'uploading' || phase === 'processing' || phase === 'publishing' || phase === 'retrying';
}

export function outputBudget(sizeBytes: number, container: AudioContainer, duration?: number) {
  const ceiling = 2 * MAX_SERVICE_AUDIO_BYTES - sizeBytes;
  const estimate = duration && Number.isFinite(duration) && duration > 0
    ? Math.ceil(duration * MP3_BYTES_PER_SECOND * 1.1) + 4 * MIB
    : container === 'webm' || container === 'ogg' ? sizeBytes * 4 : sizeBytes + 4 * MIB;
  return Math.max(MIB, Math.min(ceiling, estimate));
}

/**
 * Where the bytes go, decided by what they are (`format`, sniffed): audio every browser plays as it
 * is goes to the account's PDS while it fits a blob, and the rest gets an MP3 playback copy through
 * plyr.fm storage, the original kept. `format` is undefined when the bytes are no audio at all.
 */
export function uploadRoute(file: { size: number }, format: AudioFormat | undefined, duration?: number, closed = false): UploadRoute {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('choose a nonempty audio file.');
  if (file.size > MAX_SERVICE_AUDIO_BYTES) throw new Error('audio files are limited to 1.5 GiB.');
  if (!format) throw new Error(`this file isn't audio plyr.fm can read. choose an ${PUBLIC_AUDIO_FORMATS} file.`);
  // closed audio lives in a space on the artist's PDS, never in plyr storage, so it goes as is
  if (closed) {
    if (file.size > MAX_AUDIO_BYTES) throw new Error('closed tracks can be up to 100 MB for now.');
    return { kind: 'pds' };
  }
  if (audioRoute(format) === 'process') {
    return { kind: 'service', processing: { recipe: 'mp3-320k-44100-v1', outputBudget: outputBudget(file.size, format.container, duration) } };
  }
  return file.size > MAX_AUDIO_BYTES ? { kind: 'service' } : { kind: 'pds' };
}

/**
 * Whether a picked file will need plyr.fm storage, judged from its name and type before its bytes
 * are read, so a form can say so up front. An M4A is assumed to be AAC; the queue, which reads the
 * bytes, has the last word and asks for storage when an ALAC one turns out to need it.
 */
export function needsPlyrStorage(file: { name: string; type?: string; size: number }, closed = false) {
  if (closed) return file.size > MAX_AUDIO_BYTES;
  const container = containerFromFileType(file.name.includes('.') ? file.name.split('.').pop() : undefined) ?? containerFromContentType(file.type);
  return (container !== undefined && AUDIO_CONTAINERS[container].rule === 'process') || file.size > MAX_AUDIO_BYTES;
}

/**
 * Whether an open upload's original can live on the artist's PDS. It can up to the track lexicon's
 * `audioBlob` limit; plyr.fm storage then only adds the playable mp3. Past it, plyr.fm holds the
 * only copy, which is what the artist is asked to agree to.
 */
export function originalOnPds(file: { size: number }) {
  return file.size <= MAX_AUDIO_BYTES;
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
    case 'retrying': return `retrying ${name}…`;
    case 'awaiting-publication': return `${name} is waiting for playback confirmation`;
    case 'done': return job.error ? `${name} uploaded, but ${job.error}` : `${name} uploaded`;
    case 'failed': return job.error ? `${name} didn't upload: ${job.error}` : `${name} didn't upload`;
  }
}

/** The content type a picked file claims, in its canonical spelling, whatever its picker called it. */
export function canonicalAudioType(file: { name: string; type: string }) {
  return AUDIO_CONTAINERS[claimedContainer(file)].contentType;
}
