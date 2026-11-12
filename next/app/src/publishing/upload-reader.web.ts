import type { MediaFile } from '../pds';
import { UPLOAD_PART_BYTES, type ChunkReader } from './upload-model';
export function openUploadReader(file: MediaFile): ChunkReader {
  if (!(file instanceof Blob)) throw new Error('select the audio file again.');
  return { size: file.size, async read(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || length > UPLOAD_PART_BYTES || offset + length > file.size) throw new Error('invalid audio part range.');
    return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  }, close() {} };
}
