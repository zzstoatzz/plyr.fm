/**
 * atprotofans API client for frontend.
 * used for fetching supporter counts and lists.
 */

import { API_URL } from '$lib/config';

const ATPROTOFANS_BASE = 'https://atprotofans.com/xrpc';

export interface AtprotofansProfile {
	did: string;
	handle: string;
	displayName?: string;
	description?: string;
	acceptingSupporters: boolean;
	supporterCount: number;
}

export interface Supporter {
	did: string;
	handle: string;
	display_name?: string;
	avatar_url?: string;
}

export interface GetSupportersResponse {
	supporters: Supporter[];
	cursor?: string;
}

/**
 * fetch atprotofans profile for an artist.
 * returns supporter count and whether they accept supporters.
 */
export async function getAtprotofansProfile(did: string): Promise<AtprotofansProfile | null> {
	try {
		const url = new URL(`${ATPROTOFANS_BASE}/com.atprotofans.getProfile`);
		url.searchParams.set('subject', did);

		const response = await fetch(url.toString());
		if (!response.ok) {
			return null;
		}

		return await response.json();
	} catch (_e) {
		console.error('failed to fetch atprotofans profile:', _e);
		return null;
	}
}

/**
 * fetch list of supporters for an artist.
 * enriches with avatar_url from our backend for supporters who are plyr.fm users.
 */
export async function getAtprotofansSupporters(
	did: string,
	limit = 50,
	cursor?: string
): Promise<GetSupportersResponse | null> {
	try {
		const url = new URL(`${ATPROTOFANS_BASE}/com.atprotofans.getSupporters`);
		url.searchParams.set('subject', did);
		url.searchParams.set('limit', limit.toString());
		if (cursor) {
			url.searchParams.set('cursor', cursor);
		}

		const response = await fetch(url.toString());
		if (!response.ok) {
			return null;
		}

		const data = await response.json();

		// enrich with avatar data from our backend (for supporters who are plyr.fm users)
		if (data.supporters?.length > 0) {
			const dids = data.supporters.map((s: { did: string }) => s.did);
			const artistsResponse = await fetch(`${API_URL}/artists/batch`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(dids)
			});

			if (artistsResponse.ok) {
				const artistsMap = await artistsResponse.json();
				data.supporters = data.supporters.map(
					(s: { did: string; handle: string; displayName?: string }) => {
						const artist = artistsMap[s.did];
						return {
							did: s.did,
							handle: artist?.handle || s.handle,
							display_name: artist?.display_name || s.displayName || s.handle,
							avatar_url: artist?.avatar_url
						};
					}
				);
			}
		}

		return data;
	} catch (_e) {
		console.error('failed to fetch atprotofans supporters:', _e);
		return null;
	}
}
