/** where the face shown in the profile editor comes from. */
export type AvatarSource = 'new' | 'plyr' | 'bluesky' | 'none';

export interface BlueskyFace { avatar?: string; name?: string }

/** the bluesky avatar and display name plyr.fm falls back to when the plyr profile has none. */
export async function blueskyFace(did: string, signal?: AbortSignal): Promise<BlueskyFace> {
	const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile');
	url.searchParams.set('actor', did);
	const response = await fetch(url, { signal });
	if (!response.ok) return {};
	const profile: { avatar?: unknown; displayName?: unknown } = await response.json();
	const name = typeof profile.displayName === 'string' ? profile.displayName.trim() : '';
	return { avatar: typeof profile.avatar === 'string' && profile.avatar ? profile.avatar : undefined, ...(name ? { name } : {}) };
}

/**
 * the face listeners will see after saving. `picked` is a new photo not yet
 * saved; `cleared` means the plyr photo is being dropped, so plyr.fm falls
 * back to bluesky, exactly as the catalog does.
 */
export function shownAvatar(state: { picked?: string; cleared: boolean; stored?: string; bluesky?: string }): { url?: string; source: AvatarSource } {
	if (state.picked) return { url: state.picked, source: 'new' };
	if (state.stored && !state.cleared) return { url: state.stored, source: 'plyr' };
	if (state.bluesky) return { url: state.bluesky, source: 'bluesky' };
	return { source: 'none' };
}

/** the bio limit the lexicon enforces is 256 graphemes, not its 2560 bytes. */
export const BIO_GRAPHEMES = 256;

export function graphemes(text: string): number {
	const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
	if (Segmenter) {
		let count = 0;
		for (const _ of new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) count++;
		return count;
	}
	return Array.from(text).length;
}
