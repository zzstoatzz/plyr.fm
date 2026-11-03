import { P256Keypair } from '@atproto/crypto';
import { createSpaceSigHeaders, formatWantMacHeader, parseSpaceToken, RECORD_MAC_TYPE, WANT_MAC_HEADER } from '@atproto/space';
import { pdsEndpoint } from './identity';
import type { Agent, Auth, Did } from './auth-state';

interface Credential {
	key: P256Keypair;
	token: string;
	expires: number;
}

const credentials = new WeakMap<Agent, Map<string, Promise<Credential>>>();

export interface SpaceAudioTransport {
	keypair(): Promise<P256Keypair>;
	fetch(url: string, init: RequestInit): Promise<Response>;
}

async function mint(agent: Agent, space: string, authorityPds: string, transport: SpaceAudioTransport): Promise<Credential> {
	const delegation = await agent.handle(`/xrpc/com.atproto.space.getDelegationToken?${new URLSearchParams({ space })}`, { method: 'GET' });
	if (!delegation.ok) throw new Error('Your account cannot access this track');
	const { token: delegationToken } = await delegation.json();
	if (typeof delegationToken !== 'string') throw new Error('Invalid space delegation');

	const key = await transport.keypair();
	const response = await transport.fetch(`${authorityPds}/xrpc/com.atproto.space.getSpaceCredential`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ space, credentialKid: key.did(), delegationToken }),
		redirect: 'error'
	});
	if (!response.ok) throw new Error('Your account cannot access this track');
	const { credential: token } = await response.json();
	if (typeof token !== 'string') throw new Error('Invalid space credential');
	const { payload } = parseSpaceToken('credential', token);
	return { key, token, expires: payload.exp * 1000 };
}

export async function credentialFor(agent: Agent, space: string, authorityPds: string, transport: SpaceAudioTransport): Promise<Credential> {
	let cache = credentials.get(agent);
	if (!cache) {
		cache = new Map();
		credentials.set(agent, cache);
	}
	const existing = await cache.get(space)?.catch(() => null);
	if (existing && existing.expires > Date.now() + 30_000) return existing;
	const pending = mint(agent, space, authorityPds, transport);
	cache.set(space, pending);
	try {
		return await pending;
	} catch (error) {
		if (cache.get(space) === pending) cache.delete(space);
		throw error;
	}
}

export async function signedFetch(transport: SpaceAudioTransport, credential: Credential, url: string, audience: Did, extra: Record<string, string> = {}) {
	const headers = await createSpaceSigHeaders(credential.key, {
		authorization: `Atproto-Space-Credential ${credential.token}`,
		audience
	});
	return transport.fetch(url, { headers: { ...headers, ...extra }, redirect: 'error' });
}

function isDid(value: string): value is Did {
	return /^did:(plc|web):[^/?#]+$/.test(value);
}

export async function openGatedAudio(uri: string, auth: Auth, transport: SpaceAudioTransport): Promise<Response> {
	if (!auth.agent) throw new Error('Sign in to play this track');
	const parts = uri.slice('at://'.length).split('/');
	if (!uri.startsWith('at://') || parts.length !== 7 || parts[1] !== 'space' || parts.some(part => !part)) {
		throw new Error('Invalid space record URI');
	}
	const [authority, , type, skey, repo, collection, rkey] = parts;
	if (!isDid(authority) || !isDid(repo)) throw new Error('Invalid space record DID');
	const space = `at://${authority}/space/${type}/${skey}`;
	const authorityPds = await pdsEndpoint(authority);
	const repoPds = repo === authority ? authorityPds : await pdsEndpoint(repo);
	const credential = await credentialFor(auth.agent, space, authorityPds, transport);

	const recordParams = new URLSearchParams({ space, repo, collection, rkey });
	const macKey = await transport.keypair();
	const record = await signedFetch(transport, credential, `${repoPds}/xrpc/com.atproto.space.getRecord?${recordParams}`, repo, {
		[WANT_MAC_HEADER]: formatWantMacHeader(RECORD_MAC_TYPE, macKey.did())
	});
	if (!record.ok) throw new Error('Could not read this protected track');
	const cid = (await record.json()).value?.audioBlob?.ref?.$link;
	if (typeof cid !== 'string') throw new Error('This track has no audio');
	const blobParams = new URLSearchParams({ space, repo, cid });
	const blob = await signedFetch(transport, credential, `${repoPds}/xrpc/com.atproto.space.getBlob?${blobParams}`, repo);
	if (!blob.ok) throw new Error('Could not load this protected audio');
	return blob;
}
