const audioOrigin = 'https://plyr-next-audio.n8-3e9.workers.dev';
const mediaPath = /^\/media\/[a-f0-9]{64}\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function serviceMediaUrl(source: string): string | undefined {
  const url = new URL(source);
  if (url.origin === audioOrigin && mediaPath.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password) return url.href;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error('the audio download information is unavailable. try again.');
  return value;
}

function audio(value: unknown, expectedUrl: string) {
  const entry = object(value);
  if (entry.url !== expectedUrl || typeof entry.contentType !== 'string' || !/^audio\/[a-z0-9.+-]+$/i.test(entry.contentType)
    || typeof entry.sizeBytes !== 'number' || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes <= 0) throw new Error('the audio download information is unavailable. try again.');
  return { source: expectedUrl, mime: entry.contentType, sizeBytes: entry.sizeBytes };
}

export function parseDownloadManifest(value: unknown, source: string) {
  const base = serviceMediaUrl(source);
  if (!base) throw new Error('this source has no verified original download.');
  const manifest = object(value);
  if (typeof manifest.processed !== 'boolean') throw new Error('the audio download information is unavailable. try again.');
  return { processed: manifest.processed, playback: audio(manifest.playback, base), original: audio(manifest.original, `${base}/original`) };
}

export async function readDownloadManifest(source: string, signal?: AbortSignal) {
  const base = serviceMediaUrl(source);
  if (!base) throw new Error('this source has no verified original download.');
  const response = await fetch(`${base}/manifest`, { signal, credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('the audio download information is unavailable. try again.');
  const value: unknown = await response.json();
  return parseDownloadManifest(value, base);
}

export type DownloadManifest = ReturnType<typeof parseDownloadManifest>;
