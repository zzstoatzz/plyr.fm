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
