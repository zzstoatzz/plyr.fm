import type { Track } from './types';

/**
 * Resolve a track's cover image URL with semantic inheritance:
 * if the track has its own image, use it; otherwise fall back to the
 * album's image (if any). Every cover-rendering surface should go
 * through this helper so the inheritance rule lives in one place
 * — the player bar already implemented this inline; the detail page,
 * track lists, and embeds historically did not, leading to the same
 * track showing art in the player and a placeholder elsewhere.
 */
export function trackCoverUrl(track: Track): string | undefined {
	return track.image_url ?? track.album?.image_url ?? undefined;
}

/**
 * Resolve a track's thumbnail URL with the same inheritance rule.
 * Prefers the per-track thumbnail/image when set; otherwise falls back
 * to the album's thumbnail (then the album's full image as a last
 * resort, since not every album has a generated thumbnail yet).
 */
export function trackThumbnailUrl(track: Track): string | undefined {
	if (track.image_url) {
		return track.thumbnail_url ?? track.image_url;
	}
	return track.album?.thumbnail_url ?? track.album?.image_url ?? undefined;
}
