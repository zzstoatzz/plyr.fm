// gated audio on atproto spaces. the audio lives in a managedspace on the
// artist's own PDS; plyr is only the managing app that answers "may this
// user read?" (checkUserAccess). listeners mint a space credential from the
// artist's PDS and read the audio from it directly: no appview in the path.
import { P256Keypair } from '@atproto/crypto';
import { createSpaceSigHeaders } from '@atproto/space';
import { auth } from './auth.svelte';
import { NSID, SPACE } from './config';
import { pdsEndpoint } from './identity';

export type Gate = 'supporters' | 'signed-in';

type Did = `did:${string}:${string}`;

/** thrown when a PDS (yours or the artist's) can't do spaces yet */
export class SpacesUnsupported extends Error {}
/** thrown when the artist's gate says no */
export class NotAuthorized extends Error {}

function session() {
	if (!auth.agent || !auth.did) throw new Error('sign in first');
	return { agent: auth.agent, did: auth.did as Did };
}

type XrpcResult<T> = { ok: boolean; status: number; data: T & { error?: string; message?: string } };

/** an authenticated xrpc call to my own PDS (spaces methods aren't in atcute's lexicons yet). */
async function xrpc<T>(method: string, opts: { params?: Record<string, string>; input?: unknown }): Promise<XrpcResult<T>> {
	const { agent } = session();
	const query = opts.params ? `?${new URLSearchParams(opts.params)}` : '';
	const res = await agent.handle(
		`/xrpc/${method}${query}`,
		opts.input === undefined
			? { method: 'GET' }
			: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.input) }
	);
	const data = await res.json().catch(() => ({}));
	return { ok: res.ok, status: res.status, data };
}

export function spaceUri(authority: string, gate: Gate): string {
	return `at://${authority}/space/${SPACE.type}/${gate}`;
}

function unsupported(error: string | undefined, status?: number): boolean {
	return status === 501 || error === 'MethodNotImplemented' || error === 'InvalidScope' || error === 'invalid_scope';
}

// --- artist side -------------------------------------------------------------

/** create the artist's gate space if it doesn't exist yet. idempotent. */
export async function ensureSpace(gate: Gate): Promise<string> {
	const { did } = session();
	const r = await xrpc<{ uri?: string }>('com.atproto.space.createSpace', {
		input: {
			spaceType: SPACE.type,
			skey: gate,
			policy: { $type: 'com.atproto.managedspace.policy', managingApp: SPACE.managingApp, publishPolicy: false }
		}
	});
	if (r.ok || r.data.error === 'SpaceAlreadyExists') return spaceUri(did, gate);
	if (unsupported(r.data.error, r.status)) throw new SpacesUnsupported("your PDS doesn't support spaces yet");
	throw new Error(r.data.message ?? r.data.error ?? `createSpace ${r.status}`);
}

/** write the gated audio record into the artist's space; returns its uri. */
export async function putSpaceTrack(space: string, record: Record<string, unknown>): Promise<string> {
	const { did } = session();
	const r = await xrpc<{ uri?: string }>('com.atproto.space.createRecord', {
		input: { space, repo: did, collection: NSID.track, record }
	});
	if (!r.ok) {
		if (unsupported(r.data.error, r.status)) throw new SpacesUnsupported("your PDS doesn't support spaces yet");
		throw new Error(r.data.message ?? r.data.error ?? `space createRecord ${r.status}`);
	}
	return r.data.uri!;
}

// --- listener side -----------------------------------------------------------

interface Credential {
	key: P256Keypair;
	credential: string;
	expires: number;
}

const credentials = new Map<string, Promise<Credential>>();

/** delegation token from my PDS, then a credential from the authority's PDS. */
async function credentialFor(space: string, authorityPds: string): Promise<Credential> {
	const cached = credentials.get(space);
	if (cached) {
		const value = await cached.catch(() => null);
		if (value && value.expires > Date.now() + 30_000) return value;
		credentials.delete(space);
	}
	const minted = mint(space, authorityPds);
	credentials.set(space, minted);
	minted.catch(() => credentials.delete(space));
	return minted;
}

async function mint(space: string, authorityPds: string): Promise<Credential> {
	const d = await xrpc<{ token?: string }>('com.atproto.space.getDelegationToken', { params: { space } });
	if (!d.ok) {
		if (unsupported(d.data.error, d.status) || d.data.error === 'InsufficientScope')
			throw new SpacesUnsupported("your PDS doesn't support spaces yet");
		throw new Error(d.data.message ?? d.data.error ?? `getDelegationToken ${d.status}`);
	}
	const key = await P256Keypair.create();
	const res = await fetch(`${authorityPds}/xrpc/com.atproto.space.getSpaceCredential`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ space, credentialKid: key.did(), delegationToken: d.data.token }),
		redirect: 'manual'
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		const error = body?.error as string | undefined;
		// the managing app said no (the PDS reports a denial as not found)
		if (['UserNotAuthorized', 'NotAuthorized', 'SpaceNotFound'].includes(error ?? ''))
			throw new NotAuthorized('this track is for supporters');
		if (unsupported(error, res.status)) throw new SpacesUnsupported("the artist's PDS doesn't support spaces yet");
		throw new Error(body?.message ?? error ?? `getSpaceCredential ${res.status}`);
	}
	return { key, credential: body.credential, expires: jwtExpiry(body.credential) };
}

function jwtExpiry(jwt: string): number {
	try {
		const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
		return typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now() + 5 * 60_000;
	} catch {
		return Date.now() + 5 * 60_000;
	}
}

async function signedFetch(cred: Credential, url: string, audience: string): Promise<Response> {
	const headers = await createSpaceSigHeaders(cred.key, {
		authorization: `Atproto-Space-Credential ${cred.credential}`,
		audience: audience as Did
	});
	return fetch(url, { headers });
}

/** a parsed space record uri: at://{authority}/space/{type}/{skey}/{repo}/{collection}/{rkey} */
function parseRecordUri(uri: string) {
	const parts = uri.slice('at://'.length).split('/');
	if (!uri.startsWith('at://') || parts.length !== 7 || parts[1] !== 'space') throw new Error('bad space record uri');
	const [authority, , type, skey, repo, collection, rkey] = parts;
	return { space: `at://${authority}/space/${type}/${skey}`, authority, repo, collection, rkey };
}

/**
 * fetch gated audio: credential → space record → its audio blob, all from the
 * artist's PDS. returns an object url for the audio element.
 */
export async function gatedAudioUrl(recordUri: string): Promise<string> {
	const { space, authority, repo, collection, rkey } = parseRecordUri(recordUri);
	const authorityPds = await pdsEndpoint(authority);
	const repoPds = repo === authority ? authorityPds : await pdsEndpoint(repo);
	const cred = await credentialFor(space, authorityPds);

	const recordParams = new URLSearchParams({ space, repo, collection, rkey });
	const recordRes = await signedFetch(cred, `${repoPds}/xrpc/com.atproto.space.getRecord?${recordParams}`, repo);
	if (!recordRes.ok) throw new Error(`space record ${recordRes.status}`);
	const record = (await recordRes.json()) as { value?: { audioBlob?: { ref?: { $link?: string } } } };
	const cid = record.value?.audioBlob?.ref?.$link;
	if (!cid) throw new Error('space record has no audio');

	const blobParams = new URLSearchParams({ space, repo, cid });
	const blobRes = await signedFetch(cred, `${repoPds}/xrpc/com.atproto.space.getBlob?${blobParams}`, repo);
	if (!blobRes.ok) throw new Error(`space blob ${blobRes.status}`);
	return URL.createObjectURL(await blobRes.blob());
}
