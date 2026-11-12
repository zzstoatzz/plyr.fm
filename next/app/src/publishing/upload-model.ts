import { createOperation, type CreateOperation } from './create-operation.ts';

export const UPLOAD_PART_BYTES = 10_485_760;
export const MAX_SERVICE_AUDIO_BYTES = 1_610_612_736;
const formats: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac' };
export type UploadOperation = Omit<CreateOperation, 'cid' | 'archived'> & { uploadId: string; name: string; sizeBytes: number; contentType: string; fileType: string };
export type UploadReceipt = { number: number; sha256: string };
export type UploadStatus = {
  state: 'starting' | 'transferring' | 'completing' | 'complete' | 'published' | 'cancelling' | 'cancelled';
  recoveryRequired: boolean; reservedBytes: number; partSizeBytes: number; partCount: number;
  receivedParts: UploadReceipt[]; reservedDigests: UploadReceipt[]; audioUrl?: string;
};
export type UploadStorage = { load(owner: string): Promise<UploadOperation[]>; put(operation: UploadOperation): Promise<void>; delete(operation: UploadOperation): Promise<void> };
export type ChunkReader = { size: number; read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>; close(): void };

export function assertPublicUploadRecord(record: Record<string, unknown>): void {
  if ((Object.hasOwn(record, 'downloadPolicy') && record.downloadPolicy !== 'open')
    || (Object.hasOwn(record, 'visibility') && record.visibility !== 'public')
    || ['audioBlob', 'audioSpace', 'audioFileId', 'supportGate', 'audioPayload', 'privateAudio', 'originalAudioBlob', 'originalFileId', 'originalFileType'].some(field => Object.hasOwn(record, field))) {
    throw new Error('large uploads support public, open audio only.');
  }
}

export function audioFormat(name: string, type: string) {
  const fileType = name.split('.').at(-1)?.toLowerCase() ?? '';
  const contentType = formats[fileType];
  const normalized = ({ 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/x-flac': 'audio/flac', 'audio/x-m4a': 'audio/mp4' } as Record<string, string>)[type] ?? type;
  if (!contentType || (normalized && normalized !== contentType)) throw new Error('choose an MP3, WAV, FLAC, OGG, M4A or AAC file.');
  return { fileType, contentType };
}
export function uploadOperation(value: unknown, owner: string): UploadOperation {
  const operation = createOperation(value);
  assertPublicUploadRecord(operation.record);
  if (!value || typeof value !== 'object' || !('uploadId' in value) || !('name' in value) || !('sizeBytes' in value) || !('contentType' in value) || !('fileType' in value)
    || operation.cid !== undefined || operation.archived !== undefined || operation.owner !== owner || typeof value.uploadId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.uploadId)
    || typeof value.name !== 'string' || typeof value.sizeBytes !== 'number' || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0 || value.sizeBytes > MAX_SERVICE_AUDIO_BYTES
    || typeof value.fileType !== 'string' || typeof value.contentType !== 'string' || formats[value.fileType] !== value.contentType) throw new Error('could not read upload recovery.');
  return { ...operation, uploadId: value.uploadId, name: value.name, sizeBytes: value.sizeBytes, contentType: value.contentType, fileType: value.fileType };
}
export function uploadStatus(value: unknown, operation: UploadOperation): UploadStatus {
  if (!value || typeof value !== 'object' || !('state' in value) || !('partSizeBytes' in value) || !('partCount' in value) || !('reservedBytes' in value) || !('recoveryRequired' in value)
    || !('receivedParts' in value) || !('reservedDigests' in value) || typeof value.state !== 'string'
    || !['starting', 'transferring', 'completing', 'complete', 'published', 'cancelling', 'cancelled'].includes(value.state)
    || value.partSizeBytes !== UPLOAD_PART_BYTES || value.partCount !== Math.ceil(operation.sizeBytes / UPLOAD_PART_BYTES)
    || typeof value.recoveryRequired !== 'boolean' || !Number.isSafeInteger(value.reservedBytes) || (value.reservedBytes !== 0 && value.reservedBytes !== operation.sizeBytes)) throw new Error('invalid upload status.');
  const receipts = (items: unknown): UploadReceipt[] => {
    if (!Array.isArray(items)) throw new Error('invalid upload receipts.');
    const seen = new Set<number>();
    return items.map((item: unknown) => {
      if (!item || typeof item !== 'object' || !('number' in item) || !('sha256' in item) || typeof item.number !== 'number' || !Number.isInteger(item.number)
        || item.number < 1 || item.number > Number(value.partCount) || seen.has(item.number) || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('invalid upload receipt.');
      seen.add(item.number);
      return { number: item.number, sha256: item.sha256 };
    });
  };
  const receivedParts = receipts(value.receivedParts), reservedDigests = receipts(value.reservedDigests);
  if (receivedParts.some(part => !reservedDigests.some(reserved => reserved.number === part.number && reserved.sha256 === part.sha256))) throw new Error('upload receipts disagree.');
  const audioUrl = 'audioUrl' in value && typeof value.audioUrl === 'string' ? value.audioUrl : undefined;
  if (['complete', 'published'].includes(value.state) && !audioUrl) throw new Error('completed upload has no audio address.');
  return { state: value.state as UploadStatus['state'], recoveryRequired: value.recoveryRequired, reservedBytes: value.reservedBytes, partSizeBytes: UPLOAD_PART_BYTES,
    partCount: Number(value.partCount), receivedParts, reservedDigests, audioUrl };
}

export async function transferParts(operation: UploadOperation, reader: ChunkReader, transport: {
  status(): Promise<UploadStatus>; part(number: number, bytes: Uint8Array<ArrayBuffer>): Promise<UploadReceipt>; finish(): Promise<UploadStatus>;
}, digest: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>, signal: AbortSignal, progress: (bytes: number, checking: boolean) => void) {
  const active = () => { if (signal.aborted) throw new Error('upload paused.'); };
  try {
    active();
    if (reader.size !== operation.sizeBytes) throw new Error('choose the original file with the same size.');
    const status = await transport.status();
    active();
    if (status.state === 'complete' || status.state === 'published') return status;
    if (status.state === 'completing') return await transport.finish();
    if (status.state !== 'transferring') throw new Error('this upload cannot resume. check its status.');
    const read = async (number: number) => {
      active();
      const offset = (number - 1) * UPLOAD_PART_BYTES, length = Math.min(UPLOAD_PART_BYTES, operation.sizeBytes - offset);
      const bytes = await reader.read(offset, length);
      active();
      if (bytes.byteLength !== length) throw new Error('could not read the complete audio part.');
      return bytes;
    };
    for (const part of status.reservedDigests) {
      progress((part.number - 1) * UPLOAD_PART_BYTES, true);
      if (await digest(await read(part.number)) !== part.sha256) throw new Error('this file differs from the uploaded parts. choose the original file.');
    }
    const received = new Set(status.receivedParts.map(part => part.number));
    let sent = status.receivedParts.reduce((sum, part) => sum + Math.min(UPLOAD_PART_BYTES, operation.sizeBytes - (part.number - 1) * UPLOAD_PART_BYTES), 0);
    progress(sent, false);
    for (let number = 1; number <= status.partCount; number++) {
      if (received.has(number)) continue;
      const bytes = await read(number), sha256 = await digest(bytes);
      active();
      const receipt = await transport.part(number, bytes);
      active();
      if (receipt.number !== number || receipt.sha256 !== sha256) throw new Error('upload receipt does not match the selected file.');
      sent += bytes.byteLength;
      progress(sent, false);
    }
    active();
    return await transport.finish();
  } finally { reader.close(); }
}
