// Mirrors next/backend/src/internal/identity/record_id.zig and the copy in
// next/web/edge/link-preview.js; all three must issue the same id.
const SHORT_COLLECTION = { trk_: 'fm.plyr.track', alb_: 'fm.plyr.list', pls_: 'fm.plyr.list' } as const;
type Prefix = keyof typeof SHORT_COLLECTION;
const SHORT_URI = /^at:\/\/did:plc:([a-z2-7]{24})\/([a-z.]+)\/([A-Za-z0-9._~-]{1,512})$/;
const SHORT_ID = /^(trk|alb|pls)_([a-z2-7]{24})\.([A-Za-z0-9._~-]{1,512})$/;

function opaqueId(prefix: Prefix, uri: string): string {
	const short = SHORT_URI.exec(uri);
	if (short && short[2] === SHORT_COLLECTION[prefix] && short[3] !== '.' && short[3] !== '..') return `${prefix}${short[1]}.${short[3]}`;
	const bytes = new TextEncoder().encode(uri);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return prefix + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * /v1 ids are a type prefix + the record, reversible by design. A plyr.fm
 * record from a did:plc account is `trk_<plc id>.<rkey>`; anything else is
 * base64url of the whole AT-URI.
 */
export const trackIdFromUri = (uri: string) => opaqueId('trk_', uri);
export const playlistIdFromUri = (uri: string) => opaqueId('pls_', uri);
export const albumIdFromUri = (uri: string) => opaqueId('alb_', uri);

/**
 * The AT-URI inside an id from `trackIdFromUri` and friends, short or the
 * older long form. Anything else (an AT-URI already, or text that isn't an
 * id) comes back unchanged, so the appview answers it as an invalid request.
 */
export function uriFromId(id: string): string {
	const short = SHORT_ID.exec(id);
	if (short) return short[3] === '.' || short[3] === '..' ? id : `at://did:plc:${short[2]}/${SHORT_COLLECTION[`${short[1]}_` as Prefix]}/${short[3]}`;
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

/** The id the appview issues for whatever id or AT-URI this names. */
export function canonicalId(id: string): string {
	const prefix = /^(trk|alb|pls)_/.exec(id)?.[0] as Prefix | undefined;
	const uri = uriFromId(id);
	return prefix && uri !== id ? opaqueId(prefix, uri) : id;
}
