import type { ListSummary, Track } from './api';

export function trackArtwork(track: Track): string | undefined {
  return track.media.artwork?.url || track.artist.profile.avatar_url || undefined;
}

export function collectionArtwork(list: ListSummary): string | undefined {
  return list.media?.artwork?.url || list.owner.profile?.avatar_url || undefined;
}

// Largest displayed edge, in points, still served from a list thumbnail.
export const THUMBNAIL_MAX_SIZE = 96;

const plyrImage = /^(https:\/\/images\.plyr\.fm\/images\/(?![A-Za-z0-9_-]*_thumb\.)[A-Za-z0-9_-]+)\.(?:jpe?g|png|webp|gif)$/i;
const bskyAvatar = /^(https:\/\/cdn\.bsky\.app\/img\/)avatar(\/plain\/.+)$/;

/**
 * A small rendition of artwork for list-sized covers. Uploaded artwork can be a
 * 24-megapixel phone photo; decoding dozens of those for 48pt rows exhausts iOS
 * Safari's memory and crashes the tab. plyr stores a 96px WebP beside every image
 * (`<id>_thumb.webp`, as production's `thumbnail_url`), and Bluesky serves avatar
 * thumbnails. Other URLs are returned unchanged.
 */
export function thumbnailUrl(uri: string): string {
  const image = plyrImage.exec(uri);
  if (image) return `${image[1]}_thumb.webp`;
  const avatar = bskyAvatar.exec(uri);
  if (avatar) return `${avatar[1]}avatar_thumbnail${avatar[2]}`;
  return uri;
}

const legacyBucket = /^https:\/\/pub-7ea7ea9a6f224f4f8c0321a2bb008c5a\.r2\.dev\/images\//;
const resizable = /^(https:\/\/images(?:-stg)?\.plyr\.fm)(\/(?!cdn-cgi\/)[^?#]+)$/;
const widths = [320, 640, 1280];

/**
 * The URL to load for artwork drawn `size` points wide at `density` pixels per
 * point. Small covers use the stored thumbnail; larger plyr images are resized
 * at the CDN edge (as production's `resizedImageUrl`), in a few fixed widths so
 * the dock, the morph and now playing share cache entries. Legacy `r2.dev`
 * links are rate limited by Cloudflare, so they load from the same bucket
 * through `images.plyr.fm`.
 */
export function displayUrl(uri: string, size: number, density: number): string {
  const canonical = uri.replace(legacyBucket, 'https://images.plyr.fm/images/');
  if (size <= THUMBNAIL_MAX_SIZE) {
    const thumbnail = thumbnailUrl(canonical);
    if (thumbnail !== canonical) return thumbnail;
  }
  const image = resizable.exec(canonical);
  if (!image) return canonical;
  const width = widths.find(candidate => candidate >= size * density) ?? widths[widths.length - 1];
  return `${image[1]}/cdn-cgi/image/width=${width},quality=82,format=auto${image[2]}`;
}
