/**
 * atprotofans API client for frontend.
 * used for fetching supporter counts and lists.
 */

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
	displayName?: string;
	avatar?: string;
	supporterCount?: number;
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

		return await response.json();
	} catch (_e) {
		console.error('failed to fetch atprotofans supporters:', _e);
		return null;
	}
}
