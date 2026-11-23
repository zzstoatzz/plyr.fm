/** apps that can open an atproto profile. mirrors the legacy app's list (frontend/src/lib/atclients.ts). */
export const AT_CLIENTS = [
	{ value: 'bsky', label: 'bluesky', iconUrl: 'https://web-cdn.bsky.app/static/apple-touch-icon.png', profile: 'https://bsky.app/profile/' },
	{ value: 'blacksky', label: 'blacksky', iconUrl: 'https://blacksky.community/static/apple-touch-icon.png', profile: 'https://blacksky.community/profile/' },
	{ value: 'witchsky', label: 'witchsky', iconUrl: 'https://witchsky.app/favicon.ico', profile: 'https://witchsky.app/profile/' },
	{ value: 'reddwarf', label: 'red dwarf', iconUrl: 'https://reddwarf.app/redstar.png', profile: 'https://reddwarf.app/profile/' },
	{ value: 'pdsls', label: 'pdsls', iconUrl: 'https://pdsls.dev/favicon.ico', profile: 'https://pdsls.dev/at/' }
] as const;

export type AtClient = typeof AT_CLIENTS[number];
export type AtClientName = AtClient['value'];
export const DEFAULT_AT_CLIENT: AtClientName = 'bsky';

export function isAtClient(value: unknown): value is AtClientName {
	return AT_CLIENTS.some(client => client.value === value);
}

export function atClient(value: string | undefined): AtClient {
	return AT_CLIENTS.find(client => client.value === value) ?? AT_CLIENTS[0];
}

export function profileUrl(handleOrDid: string, value: string | undefined): string {
	return atClient(value).profile + encodeURIComponent(handleOrDid).replace(/%3A/gi, ':');
}
