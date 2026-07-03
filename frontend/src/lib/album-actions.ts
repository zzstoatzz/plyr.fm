// album API actions — every mutation the album detail page performs. callers
// own UI state and toasts; these functions own endpoints, payloads, and error
// extraction, throwing Error with the server's detail when available.
import { AtUri } from '@atproto/api';
import { API_URL } from '$lib/config';
import type { Track } from '$lib/types';

async function detailFrom(response: Response, fallback: string): Promise<string> {
	const data = await response.json().catch(() => null);
	return (data as { detail?: string } | null)?.detail || fallback;
}

export async function updateTitle(albumId: string, title: string): Promise<void> {
	const response = await fetch(`${API_URL}/albums/${albumId}?title=${encodeURIComponent(title)}`, {
		method: 'PATCH',
		credentials: 'include'
	});

	if (!response.ok) {
		// surface the server detail (e.g. the 409 on a slug collision) so the
		// caller can toast it, matching removeTrack/reorderTracks below.
		throw new Error(await detailFrom(response, 'failed to update title'));
	}
}

export async function uploadCover(albumId: string, file: File): Promise<{ image_url: string }> {
	const formData = new FormData();
	formData.append('image', file);

	const response = await fetch(`${API_URL}/albums/${albumId}/cover`, {
		method: 'POST',
		credentials: 'include',
		body: formData
	});

	if (!response.ok) {
		throw new Error('failed to upload cover');
	}

	return response.json();
}

export async function removeTrack(albumId: string, trackId: number): Promise<void> {
	const response = await fetch(`${API_URL}/albums/${albumId}/tracks/${trackId}`, {
		method: 'DELETE',
		credentials: 'include'
	});

	if (!response.ok) {
		throw new Error(await detailFrom(response, 'failed to remove track'));
	}
}

export async function deleteAlbum(albumId: string): Promise<void> {
	const response = await fetch(`${API_URL}/albums/${albumId}`, {
		method: 'DELETE',
		credentials: 'include'
	});

	if (!response.ok) {
		throw new Error('failed to delete album');
	}
}

/**
 * persist the current track order to the album's ATProto list. returns false
 * when there is nothing to persist (no list uri, no rkey, or no track with an
 * ATProto record), true after a successful save.
 */
export async function reorderTracks(
	listUri: string | null | undefined,
	tracks: Track[]
): Promise<boolean> {
	if (!listUri) return false;

	const rkey = new AtUri(listUri).rkey;
	if (!rkey) return false;

	const items = tracks
		.filter((t) => t.atproto_record_uri && t.atproto_record_cid)
		.map((t) => ({
			uri: t.atproto_record_uri!,
			cid: t.atproto_record_cid!
		}));

	if (items.length === 0) return false;

	const response = await fetch(`${API_URL}/lists/${rkey}/reorder`, {
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
