import { browser } from '$app/environment';
import { API_URL } from '$lib/config';
import type { Track } from '$lib/types';

interface TagDetail {
	name: string;
	track_count: number;
	created_by_handle: string | null;
}

export interface PageData {
	tag: TagDetail | null;
	tracks: Track[];
	error: string | null;
}

export const ssr = false;

export async function load({ params }: { params: { name: string } }): Promise<PageData> {
	if (!browser) {
		return { tag: null, tracks: [], error: null };
	}

	try {
		const response = await fetch(`${API_URL}/tracks/tags/${encodeURIComponent(params.name)}`, {
			credentials: 'include'
		});

		if (!response.ok) {
			if (response.status === 404) {
				return { tag: null, tracks: [], error: `tag "${params.name}" not found` };
			}
			throw new Error(`failed to load tag: ${response.statusText}`);
		}

		const data = await response.json();
		return {
			tag: data.tag,
			tracks: data.tracks,
			error: null
		};
	} catch (e) {
		console.error('failed to load tag:', e);
		return { tag: null, tracks: [], error: 'failed to load tag' };
	}
}
