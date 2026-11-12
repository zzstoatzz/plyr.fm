import { useSyncExternalStore } from 'react';
import { Client } from '@atcute/client';
import { BASE_SCOPE_PARTS, SCOPE_PARTS, SYNC_SCOPE_PARTS, hasJamGrant, hasSyncGrant, hasPrivatePublishGrant, hasPrivateDeleteGrant } from './auth-config';
import { didDocument, pdsEndpoint, pdsSupportsSpaces } from './identity';

export type Did = `did:${string}:${string}`;
export type Agent = { handle(path: string, init?: RequestInit): Promise<Response> };
export type Auth = {
	did: Did | null;
	ready: boolean;
	handle: string | null;
	agent: Agent | null;
	rpc: Client | null;
	jamSpace: boolean;
	accountSync: boolean;
	privatePublishing: boolean;
	privateDeleting: boolean;
	error: string | null;
	scopeRejected: boolean;
};

const initial: Auth = {
	did: null, ready: false, handle: null, agent: null, rpc: null,
	jamSpace: false, accountSync: false, privatePublishing: false, privateDeleting: false, error: null, scopeRejected: false
};

let state = initial;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export function useAuth(): Auth {
	return useSyncExternalStore(subscribe, () => state, () => initial);
}

export function clearAuth(error: string | null = null, scopeRejected = false) {
	update({ ...initial, ready: true, error, scopeRejected });
}

export function getAuth(): Auth {
	return state;
}

export function setAuth(did: Did, agent: Agent, scope: string) {
	update({ ...initial, ready: true, did, agent, rpc: new Client({ handler: agent }), jamSpace: hasJamGrant(scope), accountSync: hasSyncGrant(scope), privatePublishing: hasPrivatePublishGrant(scope), privateDeleting: hasPrivateDeleteGrant(scope) });
	void didDocument(did).then(doc => {
		if (state.agent !== agent) return;
		update({ ...state, handle: doc.alsoKnownAs?.find(value => value.startsWith('at://'))?.slice(5) ?? null });
	}).catch(() => undefined);
}

function update(next: Auth) {
	state = next;
	for (const listener of listeners) listener();
}


export async function scopeFor(identifier: string, deviceOnly: boolean): Promise<string> {
	if (deviceOnly) return BASE_SCOPE_PARTS.join(' ');
	try {
		const did = identifier.startsWith('did:') ? identifier : await resolveHandle(identifier);
		if (typeof did === 'string' && await pdsSupportsSpaces(await pdsEndpoint(did))) return SCOPE_PARTS.join(' ');
	} catch {
		/* Space scopes are optional when capability discovery fails. */
	}
	return SYNC_SCOPE_PARTS.join(' ');
}

async function resolveHandle(handle: string): Promise<unknown> {
	const url = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle';
	const response = await fetch(`${url}?handle=${encodeURIComponent(handle)}`);
	return response.ok ? (await response.json()).did : null;
}
