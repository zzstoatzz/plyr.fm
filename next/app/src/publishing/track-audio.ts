import type { MediaFile } from '../pds';

export const MAX_AUDIO_BYTES = 104_857_600;

export function canReplaceTrackAudio(record: Record<string, unknown>): boolean {
  return !['audioSpace', 'audioFileId', 'originalAudioBlob', 'originalFileId', 'originalFileType', 'supportGate'].some(key => Object.hasOwn(record, key))
    && (record.downloadPolicy === undefined || record.downloadPolicy === 'open')
    && (record.visibility === undefined || record.visibility === 'public');
}

export function validateReplacementAudio(record: Record<string, unknown>, file: MediaFile): void {
  if (!canReplaceTrackAudio(record)) throw new Error('replace protected or restricted audio in the current app.');
  if (!file.type.startsWith('audio/')) throw new Error('choose an audio file.');
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('choose a nonempty audio file.');
  if (file.size > MAX_AUDIO_BYTES) throw new Error('replacement audio is limited to 100 MiB.');
}

export function replacedTrackAudio(record: Record<string, unknown>, file: MediaFile, blob: unknown, duration?: number): Record<string, unknown> {
  validateReplacementAudio(record, file);
  const next = { ...record };
  for (const key of ['audioUrl', 'audioFileId', 'originalAudioBlob', 'originalFileId', 'originalFileType', 'duration']) delete next[key];
  next.audioBlob = blob;
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined;
  next.fileType = (extension || file.type.slice('audio/'.length)).slice(0, 16);
  if (duration !== undefined && Number.isFinite(duration) && duration > 0) next.duration = Math.round(duration);
  return next;
}

export class TrackWriteUnconfirmed extends Error {
  constructor() { super('could not confirm the saved track. reload the latest version before saving again.'); }
}
