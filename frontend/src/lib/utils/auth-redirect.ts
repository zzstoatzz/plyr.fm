import { goto } from '$app/navigation';
import { setReturnUrl, getReturnUrl, clearReturnUrl, isValidReturnPath } from './return-url';

/**
 * global post-login intent preservation.
 *
 * one mechanism for "send a logged-out user to sign in, then bring them back
 * to where they were". the destination rides in the `plyr_return_to` cookie
 * (see return-url.ts) so it survives the external OAuth round-trip; the
 * `?return_to=` param makes the same destination work for shareable links
 * (the login page arms the cookie from it).
 */

/** the spot a logged-out action should return to: path + query + hash */
export function currentIntent(): string {
	if (typeof window === 'undefined') return '/';
	return window.location.pathname + window.location.search + window.location.hash;
}

/** a /login href carrying the return destination — for declarative links + toast actions */
export function loginHref(intent: string = currentIntent()): string {
	return isValidReturnPath(intent) ? `/login?return_to=${encodeURIComponent(intent)}` : '/login';
}

/** stash where the user is and send them to sign in (defaults to the current page) */
export function redirectToLogin(intent: string = currentIntent()): void {
	setReturnUrl(intent);
	goto(loginHref(intent));
}

/** consume a stashed destination after auth; returns true if it navigated away */
export function resolvePostLogin(): boolean {
	const target = getReturnUrl();
	if (!target) return false;
	clearReturnUrl();
	window.location.href = target;
	return true;
}
