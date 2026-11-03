import type { Href } from 'expo-router';

export function returnPath(value: unknown): Href | undefined {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return;
	if (/[\\\x00-\x20\x7f]/.test(value)) return;
	let path: string;
	try {
		path = decodeURIComponent(new URL(value, 'https://plyr.invalid').pathname);
	} catch {
		return;
	}
	if (path.startsWith('//') || path.includes('\\')) return;
	if (/^\/(?:login|oauth)(?:\/|$)/i.test(path)) return;
	return value as Href;
}
