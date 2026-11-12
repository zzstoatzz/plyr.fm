import { MAX_BUFFERED_DOWNLOAD_BYTES, type PreparedDownload } from './model';

function saveLink(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.rel = 'noopener';
  document.body.append(link); link.click(); link.remove();
}

export async function saveDownload(download: PreparedDownload, signal: AbortSignal): Promise<void> {
  if (download.attachment) {
    const response = await fetch(download.attachment, { method: 'HEAD', signal, cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-disposition')?.startsWith('attachment;')) throw new Error('the download is unavailable. try again.');
    signal.throwIfAborted();
    saveLink(download.attachment, download.filename);
    return;
  }
  const response = await fetch(download.source, { signal, credentials: 'omit' });
  if (!response.ok || !response.body) throw new Error('the audio could not be downloaded. try again.');
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > MAX_BUFFERED_DOWNLOAD_BYTES) throw new Error('this source needs a direct download link for files over 100 MiB.');
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BUFFERED_DOWNLOAD_BYTES) throw new Error('this source needs a direct download link for files over 100 MiB.');
      chunks.push(new Uint8Array(chunk.value));
    }
    if (!size) throw new Error('the audio file is empty.');
    signal.throwIfAborted();
    const url = URL.createObjectURL(new Blob(chunks, { type: download.mime }));
    saveLink(url, download.filename);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
