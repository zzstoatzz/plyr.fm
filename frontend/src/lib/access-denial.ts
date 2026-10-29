import { getAtprotofansSupportUrl } from './config';
import type { PublishingDefaults } from './publishing';
import { toast } from './toast.svelte';
import { loginHref } from './utils/auth-redirect';

export function showAccessDenied(
	requiresAuth: boolean,
	artistDid: string | undefined,
	listening: PublishingDefaults['access']['listening'] | undefined
): void {
	if (listening === 'owner' || listening === 'space') {
		toast.info('track unavailable');
	} else if (requiresAuth) {
		toast.info('this track requires an account', 5000, { label: 'sign in', href: loginHref() });
	} else if (listening === 'supporters' && artistDid) {
		toast.info('this track is for supporters only', 5000, {
			label: 'become a supporter',
			href: getAtprotofansSupportUrl(artistDid)
		});
	} else {
		toast.info('track unavailable');
	}
}
