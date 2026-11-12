import { File, FileMode } from 'expo-file-system';
import type { MediaFile } from '../pds';
import { UPLOAD_PART_BYTES, type ChunkReader } from './upload-model';
export function openUploadReader(file: MediaFile): ChunkReader {
  if (!file.uri) throw new Error('select the audio file again.');
  const handle = new File(file.uri).open(FileMode.ReadOnly);
  return { size: handle.size ?? file.size, async read(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || length > UPLOAD_PART_BYTES || offset + length > file.size) throw new Error('invalid audio part range.');
    handle.offset = offset;
    return await handle.readBytes(length);
  }, close() { handle.close(); } };
}
