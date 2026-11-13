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
