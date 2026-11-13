import { Directory, File, Paths } from 'expo-file-system';
import { UploadRequestError, type createUploadTransport } from './upload-transport';
import { UPLOAD_PART_BYTES, type ChunkReader, type UploadOperation, type UploadStatus } from './upload-model';

type Transport = ReturnType<typeof createUploadTransport>;
const IN_FLIGHT = 6;

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
        return { number, sha256, file };
      }));
      try {
        const results = await Promise.all(staged.map(async part => {
          const target = await transport.partTarget(part.number);
          active();
          return { part, result: await part.file.upload(target.url, { httpMethod: 'PUT', headers: target.headers, sessionType: 'background' as never }) };
        }));
        for (const { part, result } of results) {
          if (result.status === 403) { transport.forgetCapability(); throw new UploadRequestError(503, 'upload authorization expired. retrying.'); }
          if (result.status < 200 || result.status >= 300) throw new UploadRequestError(result.status, 'upload request failed. check its status before retrying.');
          const receipt: unknown = JSON.parse(result.body);
          if (!receipt || typeof receipt !== 'object' || !('number' in receipt) || receipt.number !== part.number || !('sha256' in receipt) || receipt.sha256 !== part.sha256)
            throw new Error('upload receipt does not match the selected file.');
          sent += length(part.number);
          progress(sent, false);
        }
      } finally {
        for (const part of staged) if (part.file.exists) part.file.delete();
      }
    }
    active();
    status = await transport.finish();
    return status;
  } finally { reader.close(); }
}
