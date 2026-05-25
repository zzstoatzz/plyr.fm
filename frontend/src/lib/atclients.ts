// preferred atproto client — open profiles and records in the app of your choice.
// the registry below is the single source of truth; add an entry to support a new client.
import { browser } from '$app/environment';
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
	label: 'Bluesky',
	iconUrl: 'https://web-cdn.bsky.app/static/apple-touch-icon.png',
	profileUrl: (h) => `https://bsky.app/profile/${h}`
};

export const AT_CLIENTS: AtClient[] = [
	BSKY,
	{
		value: 'deer',
		label: 'deer.social',
		iconUrl: 'https://deer.social/favicon.ico',
		profileUrl: (h) => `https://deer.social/profile/${h}`
	},
	{
		value: 'blacksky',
		label: 'Blacksky',
		iconUrl: 'https://blacksky.community/static/apple-touch-icon.png',
		profileUrl: (h) => `https://blacksky.community/profile/${h}`
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

function storedClientValue(): string | null {
	// account preference wins; fall back to the per-browser cache so links also
	// resolve for logged-out viewers and before preferences finish loading.
	if (preferences.atprotoClient) return preferences.atprotoClient;
	if (browser) return localStorage.getItem('atprotoClient');
	return null;
}

export function getPreferredClient(): AtClient {
	const value = storedClientValue();
	return AT_CLIENTS.find((c) => c.value === value) ?? BSKY;
}

export function profileLink(handleOrDid: string): string {
	return getPreferredClient().profileUrl(handleOrDid);
}

export function recordLink(atUri: string): string {
	const client = getPreferredClient();
	if (client.recordUrl) return client.recordUrl(atUri);
	return `https://pdsls.dev/at/${atUri.replace(/^at:\/\//, '')}`;
}
