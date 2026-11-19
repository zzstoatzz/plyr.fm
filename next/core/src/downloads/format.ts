/** "FLAC · 38.2 MB", for picking between the original and the smaller copy. */
export function formatAudio(audio: { mime: string; sizeBytes?: number }): string {
  const type = audio.mime.replace(/^audio\//, '').replace(/^x-/, '').replace(/^mpeg$/, 'mp3').toUpperCase();
  if (!audio.sizeBytes) return type;
  const unit = audio.sizeBytes >= 1_000_000 ? 'MB' : 'KB';
  const size = audio.sizeBytes / (unit === 'MB' ? 1_000_000 : 1000);
  return `${type} · ${size.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}
