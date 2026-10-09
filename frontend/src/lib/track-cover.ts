import type { Track } from './types';

export function trackCoverUrl(track: Track): string | undefined {
	return track.image_url ?? track.album?.image_url ?? track.artist_avatar_url ?? undefined;
}

export function trackThumbnailUrl(track: Track): string | undefined {
	if (track.image_url) {
		return track.thumbnail_url ?? track.image_url;
	}
	return (
		track.album?.thumbnail_url ?? track.album?.image_url ?? track.artist_avatar_url ?? undefined
	);
}

/** every artwork worth trying for a full-size cover, best first; lets an image that
 * fails to load fall through to the next one instead of showing alt text. */
export function trackCoverCandidates(track: Track): string[] {
	const candidates = [
		track.image_url,
		track.image_url ? track.thumbnail_url : undefined,
		track.album?.image_url,
		track.album?.thumbnail_url,
		track.artist_avatar_url
	];
	return [...new Set(candidates.filter((url): url is string => Boolean(url)))];
}
