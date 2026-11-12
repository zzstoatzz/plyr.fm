import { Directory, File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import type { PreparedDownload } from './model';

export async function saveDownload(download: PreparedDownload, signal: AbortSignal): Promise<void> {
  if (!(await isAvailableAsync())) throw new Error('saving files is unavailable on this device.');
  signal.throwIfAborted();
  const directory = new Directory(Paths.cache, `plyr-download-${randomUUID()}`);
  directory.create();
  try {
    const file = await File.downloadFileAsync(download.source, new File(directory, download.filename), { signal });
    signal.throwIfAborted();
    if (!file.size) throw new Error('the audio file is empty.');
    await shareAsync(file.uri, { mimeType: download.mime, dialogTitle: 'save audio' });
  } finally { if (directory.exists) directory.delete(); }
}
