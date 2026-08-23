import { browser } from '$app/environment';
import { error } from '@sveltejs/kit';
import { API_URL } from '$lib/config';
import type { LoadEvent } from '@sveltejs/kit';
import type { PlaylistWithTracks, Playlist } from '$lib/types';

export interface PageData {
	playlist: PlaylistWithTracks;
	playlistMeta: Playlist | null;
}

export async function load({ params, data }: LoadEvent, ssr = !browser): Promise<PageData> {
	const id = params.id;
	if (id === undefined) {
		throw error(404, 'playlist not found');
	}

	// server data for OG tags
	const playlistMeta: Playlist | null = data?.playlistMeta ?? null;

	if (ssr) {
		// during SSR, we don't have auth - just return meta for OG tags
		// playlist will be loaded client-side
		return {
			playlist: {
				id,
				name: playlistMeta?.name ?? 'playlist',
				owner_did: playlistMeta?.owner_did ?? '',
				owner_handle: playlistMeta?.owner_handle ?? '',
				track_count: playlistMeta?.track_count ?? 0,
				image_url: playlistMeta?.image_url,
				show_on_profile: playlistMeta?.show_on_profile ?? false,
				atproto_record_uri: playlistMeta?.atproto_record_uri ?? null,
				is_private: playlistMeta?.is_private ?? false,
				created_at: playlistMeta?.created_at ?? '',
				preview_thumbnails: playlistMeta?.preview_thumbnails ?? [],
				tracks: [],
			},
			playlistMeta,
		};
	}

	// playlist endpoint is public - no auth required
	const response = await fetch(`${API_URL}/lists/playlists/${id}`, {
		credentials: 'include'
	});

	if (!response.ok) {
		if (response.status === 404) {
			throw error(404, 'playlist not found');
		}
		throw error(500, 'failed to load playlist');
	}

	const playlist = await response.json();
	return {
		playlist,
		playlistMeta,
	};
}
