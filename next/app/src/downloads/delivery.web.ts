import { MAX_BUFFERED_DOWNLOAD_BYTES, type PreparedDownload } from './model';

function saveLink(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.rel = 'noopener';
  document.body.append(link); link.click(); link.remove();
}

export async function saveDownload(download: PreparedDownload, signal: AbortSignal): Promise<void> {
  download.begin?.();
  if (download.kind === 'public' && download.attachment) {
    const response = await fetch(download.attachment, { method: 'HEAD', signal, cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-disposition')?.startsWith('attachment;')) throw new Error('the download is unavailable. try again.');
    signal.throwIfAborted();
    download.begin?.();
    saveLink(download.attachment, download.filename);
    return;
  }
  const response = download.kind === 'protected' ? await download.open() : await fetch(download.source, { signal, credentials: 'omit' });
  if (!response.ok || !response.body) throw new Error('the audio could not be downloaded. try again.');
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > MAX_BUFFERED_DOWNLOAD_BYTES) throw new Error('this source needs a direct download link for files over 100 MiB.');
    while (true) {
      download.guard?.();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BUFFERED_DOWNLOAD_BYTES) throw new Error('this source needs a direct download link for files over 100 MiB.');
      if (download.kind === 'protected' && size > download.sizeBytes) throw new Error('invalid protected audio length');
      chunks.push(new Uint8Array(chunk.value));
    }
    if (!size) throw new Error('the audio file is empty.');
    if (download.kind === 'protected') {
      download.guard();
      if (size !== download.sizeBytes) throw new Error('incomplete protected audio');
    }
    signal.throwIfAborted();
    download.guard?.();
    const url = URL.createObjectURL(new Blob(chunks, { type: download.mime }));
    saveLink(url, download.filename);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
