import { atClient, profileUrl } from '@plyr/next-core/at-clients';
import { prefs } from './prefs.svelte';

/** an account's profile in the app chosen under settings → open profiles in */
export function profileLink(handleOrDid: string): string {
	return profileUrl(handleOrDid, prefs.atprotoClient);
}

export function profileApp(): string {
	return atClient(prefs.atprotoClient).label;
}
