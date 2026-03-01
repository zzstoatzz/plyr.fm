const COOKIE_NAME = 'plyr_return_to';
const MAX_AGE = 600; // 10 minutes

/** validate a path is safe for redirect (relative, no protocol-relative) */
export function isValidReturnPath(path: string): boolean {
	return path.startsWith('/') && !path.startsWith('//');
}

export function setReturnUrl(path: string): void {
	if (!isValidReturnPath(path)) return;
	document.cookie = `${COOKIE_NAME}=${encodeURIComponent(path)}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
}

export function getReturnUrl(): string | null {
	const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
	if (!match) return null;
	const path = decodeURIComponent(match[1]);
	return isValidReturnPath(path) ? path : null;
}

export function clearReturnUrl(): void {
	document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
}
