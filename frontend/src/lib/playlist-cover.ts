import type { Playlist } from '$lib/types';

/** whether a playlist has anything for PlaylistCover to render
 * (explicit image or member-track artwork) vs. needing a placeholder */
export function hasPlaylistArt(
	playlist: Pick<Playlist, 'image_url' | 'preview_thumbnails'>
): boolean {
	return !!playlist.image_url || (playlist.preview_thumbnails?.length ?? 0) > 0;
}
