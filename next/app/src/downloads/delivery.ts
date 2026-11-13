import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import { MAX_BUFFERED_DOWNLOAD_BYTES, type PreparedDownload, type ProtectedDownload } from './model';

async function writeProtected(download: ProtectedDownload, file: File, signal: AbortSignal): Promise<void> {
  const response = await download.open();
  if (!response.ok || !response.body) throw new Error('the audio could not be downloaded. try again.');
  const reader = response.body.getReader();
  let size = 0;
  try {
    file.create();
    const handle = file.open(FileMode.WriteOnly);
    try {
      while (true) {
        signal.throwIfAborted(); download.guard();
        const chunk = await reader.read();
        signal.throwIfAborted(); download.guard();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BUFFERED_DOWNLOAD_BYTES || size > download.sizeBytes) throw new Error('invalid protected audio length');
        await handle.writeBytes(chunk.value);
      }
    } finally { handle.close(); }
    download.guard();
    if (size !== download.sizeBytes) throw new Error('incomplete protected audio');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function saveDownload(download: PreparedDownload, signal: AbortSignal): Promise<void> {
  if (!(await isAvailableAsync())) throw new Error('saving files is unavailable on this device.');
  signal.throwIfAborted();
  const directory = new Directory(Paths.cache, `plyr-download-${randomUUID()}`);
  directory.create();
  try {
    download.begin?.();
    const file = new File(directory, download.filename);
    if (download.kind === 'protected') await writeProtected(download, file, signal);
    else await File.downloadFileAsync(download.source, file, { signal });
    signal.throwIfAborted();
    download.guard?.();
    if (!file.size) throw new Error('the audio file is empty.');
    await shareAsync(file.uri, { mimeType: download.mime, dialogTitle: 'save audio' });
  } finally { if (directory.exists) directory.delete(); }
}
