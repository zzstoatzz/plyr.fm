import { Directory, File, Paths } from 'expo-file-system';
import { UploadRequestError, type createUploadTransport } from './upload-transport';
import { UPLOAD_PART_BYTES, type ChunkReader, type UploadOperation, type UploadStatus } from './upload-model';

type Transport = ReturnType<typeof createUploadTransport>;
// The audio service handles one part at a time per owner and queues at most two more, so more in flight only earns 409s.
const IN_FLIGHT = 2;

/**
 * Native sends each part as an iOS background URLSession upload from a temporary file, several at once, so the
 * transfer keeps going while the app is suspended. The audio service finishes the upload itself once every part
 * has arrived, so conversion can start before the app comes back.
 */
export async function sendParts(operation: UploadOperation, reader: ChunkReader, transport: Transport,
  digest: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>, signal: AbortSignal, progress: (bytes: number, checking: boolean) => void): Promise<UploadStatus> {
  const folder = new Directory(Paths.cache, 'plyr-upload-parts');
  const active = () => { if (signal.aborted) throw new Error('upload paused.'); };
  const length = (number: number) => Math.min(UPLOAD_PART_BYTES, operation.sizeBytes - (number - 1) * UPLOAD_PART_BYTES);
  async function read(number: number) {
    active();
    const bytes = await reader.read((number - 1) * UPLOAD_PART_BYTES, length(number));
    if (bytes.byteLength !== length(number)) throw new Error('could not read the complete audio part.');
    return bytes;
  }
  try {
    if (reader.size !== operation.sizeBytes) throw new Error('choose the original file with the same size.');
    let status = await transport.status();
    if (status.state === 'complete' || status.state === 'published') return status;
    if (status.state === 'completing' || status.state === 'processing') return await transport.finish();
    if (status.state !== 'transferring') throw new Error('this upload cannot resume. check its status.');
    for (const part of status.reservedDigests) {
      progress((part.number - 1) * UPLOAD_PART_BYTES, true);
      if (await digest(await read(part.number)) !== part.sha256) throw new Error('this file differs from the uploaded parts. choose the original file.');
    }
    if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
    const received = new Set(status.receivedParts.map(part => part.number));
    let sent = [...received].reduce((sum, number) => sum + length(number), 0);
    progress(sent, false);
    const missing = Array.from({ length: status.partCount }, (_, index) => index + 1).filter(number => !received.has(number));
    for (let start = 0; start < missing.length; start += IN_FLIGHT) {
      const batch = missing.slice(start, start + IN_FLIGHT);
      const staged = await Promise.all(batch.map(async number => {
        const bytes = await read(number), sha256 = await digest(bytes);
        const file = new File(folder, `${operation.uploadId}-${number}.part`);
        if (file.exists) file.delete();
        file.create();
        await file.write(bytes);
        return { number, sha256, bytes, file };
      }));
      // Every native task must settle before its file goes: iOS raises an uncatchable exception for a background
      // upload whose source file is missing, so a sibling's failure cannot delete files still queued.
      const settled = await Promise.allSettled(staged.map(async part => {
        const target = await transport.partTarget(part.number);
        active();
        if (!part.file.exists) throw new Error('the staged audio part is missing.');
        try {
          const result = await part.file.upload(target.url, { httpMethod: 'PUT', headers: target.headers, sessionType: 'background' });
          if (result.status === 403) { transport.forgetCapability(); throw new UploadRequestError(503, 'upload authorization expired. retrying.'); }
          if (result.status === 409 || result.status === 429 || result.status >= 500) throw new UploadRequestError(result.status, 'upload service is busy. retrying.');
          if (result.status < 200 || result.status >= 300) throw new UploadRequestError(result.status, 'upload request failed. check its status before retrying.');
          return { part, receipt: JSON.parse(result.body) as unknown };
        } catch (failure) {
          if (failure instanceof UploadRequestError) throw failure;
          // The background session refused the task itself: send this part in the foreground rather than stall.
          console.warn('background part upload failed; sending in the foreground', failure);
          active();
          return { part, receipt: await transport.part(part.number, part.bytes) as unknown };
        }
      }));
      for (const part of staged) if (part.file.exists) part.file.delete();
      for (const outcome of settled) if (outcome.status === 'rejected') throw outcome.reason;
      for (const outcome of settled) {
        if (outcome.status !== 'fulfilled') continue;
        const { part, receipt } = outcome.value;
        if (!receipt || typeof receipt !== 'object' || !('number' in receipt) || receipt.number !== part.number || !('sha256' in receipt) || receipt.sha256 !== part.sha256)
          throw new Error('upload receipt does not match the selected file.');
        sent += length(part.number);
        progress(sent, false);
      }
    }
    active();
    status = await transport.finish();
    return status;
  } finally { reader.close(); }
}
