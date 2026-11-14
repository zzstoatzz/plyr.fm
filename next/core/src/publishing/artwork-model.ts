/** The track lexicon's imageBlob accepts these, up to 10 MB. */
export const ARTWORK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const MAX_ARTWORK_BYTES = 10_000_000;
/** Covers show at a few hundred points; anything this side of 2000 px stays sharp on any screen. */
export const ARTWORK_EDGE = 2000;
export const UNREADABLE_ARTWORK = 'couldn\'t read that image. choose a photo, or a JPEG, PNG, WebP or GIF file.';

const ALIASES: Record<string, string> = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/x-png': 'image/png' };

export function artworkType(type: string) {
  const normalized = type.toLowerCase().split(';')[0].trim();
  return ALIASES[normalized] ?? normalized;
}

/**
 * Keep the picked file when the lexicon takes it as is; otherwise re-encode it as JPEG. That covers iPhone HEIC
 * photos, TIFF or BMP from a desktop, and photos too large or too big to upload, the way production normalizes covers.
 */
export function artworkPlan(file: { type: string; size: number }, width?: number, height?: number): { keep: true } | { keep: false; width?: number } {
  const type = artworkType(file.type);
  const edge = Math.max(width ?? 0, height ?? 0);
  if ((ARTWORK_TYPES as readonly string[]).includes(type) && file.size > 0 && file.size <= MAX_ARTWORK_BYTES && (type === 'image/gif' || edge <= 4096)) return { keep: true };
  if (!width || !height) return { keep: false, width: ARTWORK_EDGE };
  return edge > ARTWORK_EDGE ? { keep: false, width: width >= height ? ARTWORK_EDGE : Math.round(ARTWORK_EDGE * width / height) } : { keep: false };
}

export function artworkName(name: string) {
  const base = name.replace(/\.[^.]+$/, '') || 'cover';
  return `${base}.jpg`;
}
