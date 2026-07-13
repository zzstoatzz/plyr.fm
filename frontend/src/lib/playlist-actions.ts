// playlist API actions — every read/mutation the playlist detail page performs.
// callers own UI state and toasts; these functions own endpoints, payloads, and
// error extraction, throwing Error with the server's detail when available.
import { API_URL } from '$lib/config';
import type { Playlist, Track } from '$lib/types';

/** a track candidate for adding to the playlist (search result or recommendation). */
export interface PlaylistTrackCandidate {
	id: number;
	title: string;
	artist_display_name: string;
	/** present on search results ("track" | "artist" | ...), absent on recommendations */
	type?: string;
	atproto_record_uri?: string | null;
	image_url?: string | null;
}

export interface PlaylistRecommendations {
	available: boolean;
	tracks: PlaylistTrackCandidate[];
}

export interface PlaylistUpdate {
	name?: string;
	show_on_profile?: boolean;
	is_private?: boolean;
}

async function detailFrom(response: Response, fallback: string): Promise<string> {
	const data = await response.json().catch(() => null);
	return (data as { detail?: string } | null)?.detail || fallback;
}

export async function searchTracks(query: string, limit = 10): Promise<PlaylistTrackCandidate[]> {
	const response = await fetch(
		`${API_URL}/search/?q=${encodeURIComponent(query)}&type=tracks&limit=${limit}`,
		{ credentials: 'include' }
	);

	if (!response.ok) {
		throw new Error('search failed');
	}

	const data = await response.json();
	return data.results;
}

export async function fetchRecommendations(
	playlistId: string,
	limit = 3
): Promise<PlaylistRecommendations> {
	const response = await fetch(
		`${API_URL}/lists/playlists/${playlistId}/recommendations?limit=${limit}`,
		{ credentials: 'include' }
	);

	if (!response.ok) {
		return { available: false, tracks: [] };
	}

	return response.json();
}

/** fetch full track details, validate its ATProto record, and add it to the playlist. */
export async function addTrack(playlistId: string, trackId: number): Promise<Track> {
	const trackResponse = await fetch(`${API_URL}/tracks/${trackId}`, {
		credentials: 'include'
	});

	if (!trackResponse.ok) {
		throw new Error('failed to fetch track details');
	}

	const track: Track = await trackResponse.json();

	if (!track.atproto_record_uri || !track.atproto_record_cid) {
		throw new Error('track does not have ATProto record');
	}

	const response = await fetch(`${API_URL}/lists/playlists/${playlistId}/tracks`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			track_uri: track.atproto_record_uri,
			track_cid: track.atproto_record_cid
		})
	});

	if (!response.ok) {
		throw new Error(await detailFrom(response, 'failed to add track'));
	}

	return track;
}

export async function removeTrack(playlistId: string, trackUri: string): Promise<void> {
	const response = await fetch(
		`${API_URL}/lists/playlists/${playlistId}/tracks/${encodeURIComponent(trackUri)}`,
		{ method: 'DELETE', credentials: 'include' }
	);

	if (!response.ok) {
		throw new Error(await detailFrom(response, 'failed to remove track'));
	}
}

export async function updatePlaylist(
	playlistId: string,
	update: PlaylistUpdate
): Promise<Playlist> {
	const formData = new FormData();
	if (update.name !== undefined) {
		formData.append('name', update.name);
	}
	if (update.show_on_profile !== undefined) {
		formData.append('show_on_profile', String(update.show_on_profile));
	}
	if (update.is_private !== undefined) {
		formData.append('is_private', String(update.is_private));
	}

	const response = await fetch(`${API_URL}/lists/playlists/${playlistId}`, {
		method: 'PATCH',
		credentials: 'include',
		body: formData
	});

	if (!response.ok) {
		throw new Error(await detailFrom(response, 'failed to update playlist'));
	}

	return response.json();
}

export async function uploadCover(playlistId: string, file: File): Promise<{ image_url: string }> {
	const formData = new FormData();
	formData.append('image', file);

	const response = await fetch(`${API_URL}/lists/playlists/${playlistId}/cover`, {
		method: 'POST',
		credentials: 'include',
		body: formData
	});

	if (!response.ok) {
		throw new Error('failed to upload cover');
	}

	return response.json();
}

/** remove the explicit cover — the composite (member-track artwork) takes over. */
export async function removeCover(playlistId: string): Promise<Playlist> {
	const response = await fetch(`${API_URL}/lists/playlists/${playlistId}/cover`, {
		method: 'DELETE',
		credentials: 'include'
	});

	if (!response.ok) {
		throw new Error(await detailFrom(response, 'failed to remove cover'));
	}

	return response.json();
}

/**
 * persist the current track order. returns false when no track has an ATProto
 * record to reference (nothing to persist), true after a successful save.
 */
export async function reorderTracks(playlistId: string, tracks: Track[]): Promise<boolean> {
	const items = tracks
		.filter((t) => t.atproto_record_uri && t.atproto_record_cid)
		.map((t) => ({
			uri: t.atproto_record_uri!,
			cid: t.atproto_record_cid!
		}));

	if (items.length === 0) {
		return false;
	}

	// /lists/playlists/{id}/reorder routes both private and public; the older
	// /lists/{rkey}/reorder is public-only and is left for backwards
	// compatibility with non-playlist list types.
	const response = await fetch(`${API_URL}/lists/playlists/${playlistId}/reorder`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ items })
	});

	if (!response.ok) {
		throw new Error(await detailFrom(response, 'failed to save order'));
	}

	return true;
}

export async function deletePlaylist(playlistId: string): Promise<void> {
	const response = await fetch(`${API_URL}/lists/playlists/${playlistId}`, {
		method: 'DELETE',
		credentials: 'include'
	});

	if (!response.ok) {
		throw new Error('failed to delete playlist');
	}
}
