import type { Agent, Auth, Did } from './auth-state.ts';
import { didDocument, pdsEndpoint } from './identity.ts';

const spaceCredentialPath = '/xrpc/com.atproto.space.';
const credentialMethods = ['authorizeSpaceSync', 'getSpaceCredential'] as const;

export function isSpaceCredentialRequest(url: string): boolean {
	const { pathname } = new URL(url);
	return credentialMethods.some(method => pathname === spaceCredentialPath + method);
}

type SpaceKey = { did(): string };

export interface SpaceAudioTransport<Key extends SpaceKey> {
	keypair(): Promise<Key>;
	fetch(url: string, init: RequestInit): Promise<Response>;
	guard?(): void;
}

export interface GatedAudioSource {
	url: string;
	size: number;
	mimeType: string;
	headers(): Promise<Record<string, string>>;
}

export interface SpaceAudioSdk<Key extends SpaceKey, RecordValue extends Record<string, unknown>> {
	isSpaceAtUriString(value: string): boolean;
	parseSpaceToken(type: 'credential', token: string): { payload: { exp: number } };
	createSpaceSigHeaders(input: { keypair: Key; authorization: string; audience: Did }): Promise<{ headers: Record<string, string> }>;
	encapsulate(key: Did): Promise<{ keyShare: Did; sharedSecret: Uint8Array }>;
	formatMacRequest(profile: 'atproto-space-record', keyShare: Did): string;
	RECORD_MAC_PROFILE: 'atproto-space-record';
	verifyRecord(record: { uri: string; cid: string; value: RecordValue }, params: {
		uri: string; keyShare: Did; sharedSecret: Uint8Array; headers: Headers;
	}): Promise<void>;
	lexParse(text: string, options: { strict: true }): unknown;
	isLexMap(value: unknown): value is RecordValue;
	isCid(value: unknown): value is { toString(): string };
}

export function createGatedAudio<Key extends SpaceKey, RecordValue extends Record<string, unknown>>(
	sdk: SpaceAudioSdk<Key, RecordValue>
) {
	const { isSpaceAtUriString, parseSpaceToken, createSpaceSigHeaders, encapsulate, formatMacRequest,
		RECORD_MAC_PROFILE, verifyRecord, lexParse, isLexMap, isCid } = sdk;

	interface Credential {
		key: Key;
		token: string;
		expires: number;
	}

	const credentials = new WeakMap<Agent, Map<string, Promise<Credential>>>();

	async function mint(agent: Agent, space: string, authorityPds: string, transport: SpaceAudioTransport<Key>): Promise<Credential> {
		const delegation = await agent.handle(`/xrpc/com.atproto.space.getDelegationToken?${new URLSearchParams({ space })}`, { method: 'GET' });
		if (!delegation.ok) throw new Error('your account cannot access this track');
		const { token: delegationToken } = await delegation.json();
		if (typeof delegationToken !== 'string') throw new Error('invalid space delegation');

		const key = await transport.keypair();
		const request: RequestInit = {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ space, credentialKey: key.did(), delegationToken }),
			redirect: 'error'
		};
		const address = authorityPds + spaceCredentialPath;
		let response = await transport.fetch(address + credentialMethods[0], request);
		if (response.status === 404) {
			const failure: { error?: string } | undefined = await response.json().catch(() => undefined);
			if (failure?.error === 'UnknownMethod') response = await transport.fetch(address + credentialMethods[1], request);
		}
		if (!response.ok) throw new Error('your account cannot access this track');
		const { credential: token } = await response.json();
		if (typeof token !== 'string') throw new Error('invalid space credential');
		const { payload } = parseSpaceToken('credential', token);
		return { key, token, expires: payload.exp * 1000 };
	}

	async function credentialFor(agent: Agent, space: string, authorityPds: string, transport: SpaceAudioTransport<Key>): Promise<Credential> {
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

	async function signedFetch(transport: SpaceAudioTransport<Key>, credential: Credential, url: string, audience: Did, extra: Record<string, string> = {}) {
		const { headers } = await createSpaceSigHeaders({
			keypair: credential.key,
			authorization: `Atproto-Space-Credential ${credential.token}`,
			audience
		});
		return transport.fetch(url, { headers: { ...headers, ...extra }, redirect: 'error' });
	}

	function isDid(value: string): value is Did {
		return /^did:(plc|web):[^/?#]+$/.test(value);
	}

	async function resolveGatedAudio(uri: string, auth: Pick<Auth<unknown>, 'agent'>, transport: SpaceAudioTransport<Key>, validate?: (record: RecordValue) => void): Promise<GatedAudioSource> {
		if (!auth.agent) throw new Error('sign in to play this track');
		const agent = auth.agent;
		const parts = uri.slice('at://'.length).split('/');
		if (!isSpaceAtUriString(uri) || parts.length !== 7 || parts[1] !== 'space' || parts.some(part => !part)) {
			throw new Error('invalid space record uri');
		}
		const [authority, , type, skey, repo, collection, rkey] = parts;
		if (!isDid(authority) || !isDid(repo)) throw new Error('invalid space record did');
		const space = `at://${authority}/space/${type}/${skey}`;
		const authorityPds = await pdsEndpoint(authority);
		const repoPds = repo === authority ? authorityPds : await pdsEndpoint(repo);
		const didDoc = await didDocument(repo);
		const kem = didDoc.verificationMethod?.find(method => method.id === `${repo}#atproto_kem`)?.publicKeyMultibase;
		if (!kem) throw new Error('this track has no verification key');
		transport.guard?.();
		const [{ keyShare, sharedSecret }, credential] = await Promise.all([
			encapsulate(`did:key:${kem}`), credentialFor(agent, space, authorityPds, transport)
		]);
		const recordParams = new URLSearchParams({ space, repo, collection, rkey });
		const record = await signedFetch(transport, credential, `${repoPds}/xrpc/com.atproto.space.getRecord?${recordParams}`, repo, {
			'accept-signature': formatMacRequest(RECORD_MAC_PROFILE, keyShare)
		});
		if (!record.ok) throw new Error('could not read this protected track');
		const decoded = lexParse(await record.text(), { strict: true });
		if (!isLexMap(decoded) || typeof decoded.uri !== 'string' || typeof decoded.cid !== 'string' || !isLexMap(decoded.value)) {
			throw new Error('invalid protected track');
		}
		const value = { uri: decoded.uri, cid: decoded.cid, value: decoded.value };
		if (value.value.$type !== collection) {
			throw new Error('could not verify this protected track');
		}
		try {
			await verifyRecord(value, { uri, keyShare, sharedSecret, headers: record.headers });
		} catch {
			throw new Error('could not verify this protected track');
		}
		validate?.(value.value);
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
				return (await createSpaceSigHeaders({
					keypair: current.key,
					authorization: `Atproto-Space-Credential ${current.token}`, audience: repo
				})).headers;
			}
		};
	}

	async function openGatedAudio(uri: string, auth: Pick<Auth<unknown>, 'agent'>, transport: SpaceAudioTransport<Key>): Promise<Response> {
		const source = await resolveGatedAudio(uri, auth, transport);
		const blob = await transport.fetch(source.url, { headers: await source.headers(), redirect: 'error', cache: 'no-store' });
		if (!blob.ok) throw new Error('could not load this protected audio');
		return blob;
	}

	return { credentialFor, signedFetch, resolveGatedAudio, openGatedAudio };
}
