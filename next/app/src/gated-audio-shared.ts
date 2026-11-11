import { P256Keypair } from '@atproto/crypto';
import { createSpaceSigHeaders, encapsulate, formatWantMacHeader, MAC_HEADER, parseMacHeader, parseSpaceToken, RECORD_MAC_TYPE, verifyRecord, WANT_MAC_HEADER } from '@atproto/space';
import { isCid, isLexMap } from '@atproto/lex-data';
import { lexParse } from '@atproto/lex-json';
import { didDocument, pdsEndpoint } from './identity.ts';
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
	if (!delegation.ok) throw new Error('your account cannot access this track');
	const { token: delegationToken } = await delegation.json();
	if (typeof delegationToken !== 'string') throw new Error('invalid space delegation');

	const key = await transport.keypair();
	const response = await transport.fetch(`${authorityPds}/xrpc/com.atproto.space.getSpaceCredential`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ space, credentialKid: key.did(), delegationToken }),
		redirect: 'error'
	});
	if (!response.ok) throw new Error('your account cannot access this track');
	const { credential: token } = await response.json();
	if (typeof token !== 'string') throw new Error('invalid space credential');
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

export interface GatedAudioSource {
	url: string;
	size: number;
	mimeType: string;
	headers(): Promise<Record<string, string>>;
}

export async function resolveGatedAudio(uri: string, auth: Auth, transport: SpaceAudioTransport): Promise<GatedAudioSource> {
	if (!auth.agent) throw new Error('sign in to play this track');
	const agent = auth.agent;
	const parts = uri.slice('at://'.length).split('/');
	if (!uri.startsWith('at://') || parts.length !== 7 || parts[1] !== 'space' || parts.some(part => !part)) {
		throw new Error('invalid space record uri');
	}
	const [authority, , type, skey, repo, collection, rkey] = parts;
	if (!isDid(authority) || !isDid(repo)) throw new Error('invalid space record did');
	const space = `at://${authority}/space/${type}/${skey}`;
	const authorityPds = await pdsEndpoint(authority);
	const repoPds = repo === authority ? authorityPds : await pdsEndpoint(repo);
	const document = await didDocument(repo);
	const kem = document.verificationMethod?.find(method => method.id === `${repo}#atproto_kem`)?.publicKeyMultibase;
	if (!kem) throw new Error('this track has no verification key');
	const [{ keyShare, sharedSecret }, credential] = await Promise.all([
		encapsulate(`did:key:${kem}`), credentialFor(agent, space, authorityPds, transport)
	]);
	const recordParams = new URLSearchParams({ space, repo, collection, rkey });
	const record = await signedFetch(transport, credential, `${repoPds}/xrpc/com.atproto.space.getRecord?${recordParams}`, repo, {
		[WANT_MAC_HEADER]: formatWantMacHeader(RECORD_MAC_TYPE, keyShare)
	});
	if (!record.ok) throw new Error('could not read this protected track');
	const decoded = lexParse(await record.text(), { strict: true });
	if (!isLexMap(decoded) || typeof decoded.uri !== 'string' || typeof decoded.cid !== 'string' || !isLexMap(decoded.value)) {
		throw new Error('invalid protected track');
	}
	const value = { uri: decoded.uri, cid: decoded.cid, value: decoded.value };
	const mac = parseMacHeader(record.headers.get(MAC_HEADER) ?? undefined, RECORD_MAC_TYPE);
	if (value.value.$type !== collection || !await verifyRecord(value, { uri, mac, sharedSecret })) {
		throw new Error('could not verify this protected track');
	}
	const blob = value.value.audioBlob;
	if (!isLexMap(blob) || !isCid(blob.ref) || typeof blob.size !== 'number' || !Number.isSafeInteger(blob.size)
		|| blob.size <= 0 || blob.size > 104_857_600 || typeof blob.mimeType !== 'string' || !/^audio\/[a-z0-9.+-]+$/i.test(blob.mimeType)) {
		throw new Error('this track has no playable audio');
	}
	const blobParams = new URLSearchParams({ space, repo, cid: blob.ref.toString() });
	return {
		url: `${repoPds}/xrpc/com.atproto.space.getBlob?${blobParams}`,
		size: blob.size,
		mimeType: blob.mimeType,
		async headers() {
			const current = await credentialFor(agent, space, authorityPds, transport);
			return createSpaceSigHeaders(current.key, {
				authorization: `Atproto-Space-Credential ${current.token}`, audience: repo
			});
		}
	};
}

export async function openGatedAudio(uri: string, auth: Auth, transport: SpaceAudioTransport): Promise<Response> {
	const source = await resolveGatedAudio(uri, auth, transport);
	const blob = await transport.fetch(source.url, { headers: await source.headers(), redirect: 'error', cache: 'no-store' });
	if (!blob.ok) throw new Error('could not load this protected audio');
	return blob;
}
