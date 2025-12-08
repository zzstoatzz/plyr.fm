import { browser } from '$app/environment';
import { redirect, error } from '@sveltejs/kit';
import { API_URL } from '$lib/config';
import type { LoadEvent } from '@sveltejs/kit';
import type { PlaylistWithTracks, Playlist } from '$lib/types';

export interface PageData {
	playlist: PlaylistWithTracks;
	playlistMeta: Playlist | null;
}

export async function load({ params, parent, data }: LoadEvent): Promise<PageData> {
	// server data for OG tags
	const serverData = data as { playlistMeta: Playlist | null } | undefined;

	if (!browser) {
		// during SSR, we don't have auth - just return meta for OG tags
		// playlist will be loaded client-side
		return {
			playlist: {
				id: params.id as string,
				name: serverData?.playlistMeta?.name ?? 'playlist',
				owner_did: serverData?.playlistMeta?.owner_did ?? '',
				owner_handle: serverData?.playlistMeta?.owner_handle ?? '',
				track_count: serverData?.playlistMeta?.track_count ?? 0,
				image_url: serverData?.playlistMeta?.image_url,
				show_on_profile: serverData?.playlistMeta?.show_on_profile ?? false,
				atproto_record_uri: serverData?.playlistMeta?.atproto_record_uri ?? '',
				created_at: serverData?.playlistMeta?.created_at ?? '',
				tracks: [],
			},
			playlistMeta: serverData?.playlistMeta ?? null,
		};
	}

	// check auth from parent layout data
	const { isAuthenticated } = await parent();
	if (!isAuthenticated) {
		throw redirect(302, '/');
	}

	const response = await fetch(`${API_URL}/lists/playlists/${params.id}`, {
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
		playlistMeta: serverData?.playlistMeta ?? null,
	};
}
