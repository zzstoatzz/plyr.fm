function opaqueId(prefix: string, uri: string): string {
	const bytes = new TextEncoder().encode(uri);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return prefix + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** /v1 ids are a type prefix + base64url(at-uri), reversible by design. */
export const trackIdFromUri = (uri: string) => opaqueId('trk_', uri);
export const playlistIdFromUri = (uri: string) => opaqueId('pls_', uri);
export const albumIdFromUri = (uri: string) => opaqueId('alb_', uri);

/**
 * The AT-URI inside an id from `trackIdFromUri` and friends. Anything else (an
 * AT-URI already, or text that isn't an id) comes back unchanged, so the
 * appview answers it as an invalid request.
 */
export function uriFromId(id: string): string {
	const match = /^(?:trk|alb|pls)_([A-Za-z0-9_-]+)$/.exec(id);
	if (!match) return id;
	try {
		const payload = match[1].replace(/-/g, '+').replace(/_/g, '/');
		const bin = atob(payload + '='.repeat((4 - (payload.length % 4)) % 4));
		const uri = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
		return uri.startsWith('at://') ? uri : id;
	} catch {
		return id;
	}
}
