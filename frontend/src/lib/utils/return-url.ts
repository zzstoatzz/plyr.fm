const COOKIE_NAME = 'plyr_return_to';
const MAX_AGE = 600; // 10 minutes

export function setReturnUrl(path: string): void {
	// only allow relative paths starting with / (prevent open redirects)
	if (!path.startsWith('/') || path.startsWith('//')) return;
	document.cookie = `${COOKIE_NAME}=${encodeURIComponent(path)}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
}

export function getReturnUrl(): string | null {
	const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
	return match ? decodeURIComponent(match[1]) : null;
}

export function clearReturnUrl(): void {
	document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
}
