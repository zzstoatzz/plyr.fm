import { getAtprotofansSupportUrl } from './config';
import type { PublishingDefaults } from './publishing';
import { toast } from './toast.svelte';
import { loginHref } from './utils/auth-redirect';

export function showAccessDenied(
	requiresAuth: boolean,
	artistDid: string | undefined,
	listening: PublishingDefaults['access']['listening'] | undefined
): void {
	if (requiresAuth) {
		toast.info(
			listening === 'owner'
				? 'only the artist can play this track'
				: 'this track requires an account',
			5000,
			{ label: 'sign in', href: loginHref() }
		);
	} else if (listening === 'supporters' && artistDid) {
		toast.info('this track is for supporters only', 5000, {
			label: 'become a supporter',
			href: getAtprotofansSupportUrl(artistDid)
		});
	} else if (listening === 'owner') {
		toast.info('only the artist can play this track');
	} else if (listening === 'space') {
		toast.info('this track requires Space membership');
	} else {
		toast.info('you do not have access to this track');
	}
}
