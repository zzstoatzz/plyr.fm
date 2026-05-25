// preferred atproto client — open profiles and records in the app of your choice.
// the registry mirrors the shared client list in leaflet-search / status
// (@zzstoatzz.io); keep it in sync with those rather than inventing entries.
import { preferences } from '$lib/preferences.svelte';

export interface AtClient {
	value: string;
	label: string;
	iconUrl: string;
	profileUrl: (handleOrDid: string) => string;
	recordUrl?: (atUri: string) => string;
}

const BSKY: AtClient = {
	value: 'bsky',
	label: 'bluesky',
	iconUrl: 'https://web-cdn.bsky.app/static/apple-touch-icon.png',
	profileUrl: (h) => `https://bsky.app/profile/${h}`
};

export const AT_CLIENTS: AtClient[] = [
	BSKY,
	{
		value: 'blacksky',
		label: 'blacksky',
		iconUrl: 'https://blacksky.community/static/apple-touch-icon.png',
		profileUrl: (h) => `https://blacksky.community/profile/${h}`
	},
	{
		value: 'witchsky',
		label: 'witchsky',
		iconUrl: 'https://witchsky.app/favicon.ico',
		profileUrl: (h) => `https://witchsky.app/profile/${h}`
	},
	{
		value: 'reddwarf',
		label: 'red dwarf',
		iconUrl: 'https://reddwarf.app/redstar.png',
		profileUrl: (h) => `https://reddwarf.app/profile/${h}`
	},
	{
		value: 'pdsls',
		label: 'pdsls',
		iconUrl: 'https://pdsls.dev/favicon.ico',
		profileUrl: (h) => `https://pdsls.dev/at/${h}`,
		recordUrl: (uri) => `https://pdsls.dev/at/${uri.replace(/^at:\/\//, '')}`
	}
];

export const DEFAULT_AT_CLIENT = BSKY.value;

// resolve a client purely from the account-scoped preference value.
// deliberately does NOT read localStorage: a single global cache would leak one
// account's choice into another after switching accounts (the picker reads the
// account pref, so a global fallback makes links disagree with settings).
export function resolveClient(value: string | null | undefined): AtClient {
	return AT_CLIENTS.find((c) => c.value === value) ?? BSKY;
}

export function getPreferredClient(): AtClient {
	return resolveClient(preferences.atprotoClient);
}

export function profileLink(handleOrDid: string): string {
	return getPreferredClient().profileUrl(handleOrDid);
}

export function recordLink(atUri: string): string {
	const client = getPreferredClient();
	if (client.recordUrl) return client.recordUrl(atUri);
	return `https://pdsls.dev/at/${atUri.replace(/^at:\/\//, '')}`;
}
