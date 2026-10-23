// same rewrite as frontend/src/lib/utils/display-image.ts, without URL (absent on Hermes); images.test.ts holds parity
const RESIZABLE = /^(https:\/\/(?:images|images-stg)\.plyr\.fm(?::\d+)?)(\/[^?#]*)/;
const TRANSFORM_PREFIX = "/cdn-cgi/image/";

export const IMAGE_WIDTHS = {
  thumb: 96,
  tile: 320,
  hero: 640,
} as const;

/** Ask the image CDN for a display-sized rendition; other hosts pass through. */
export function resizedImageUrl(url: string | null | undefined, width: number): string | null {
  if (!url) return null;
  const match = RESIZABLE.exec(url);
  if (!match || match[2].startsWith(TRANSFORM_PREFIX)) return url;
  return `${match[1]}${TRANSFORM_PREFIX}width=${width},quality=82,format=auto${match[2]}`;
}

type Covered = {
  image_url: string | null;
  thumbnail_url?: string | null;
  artist_avatar_url: string | null;
  album: { image_url: string | null; thumbnail_url?: string | null } | null;
};

// same fallbacks as frontend/src/lib/track-cover.ts; images.test.ts holds parity
export function trackCoverUrl(track: Covered): string | null {
  return track.image_url ?? track.album?.image_url ?? track.artist_avatar_url ?? null;
}

export function trackThumbnailUrl(track: Covered): string | null {
  if (track.image_url) return track.thumbnail_url ?? track.image_url;
  return track.album?.thumbnail_url ?? track.album?.image_url ?? track.artist_avatar_url ?? null;
}
