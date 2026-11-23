import type { AuthConfig } from './auth-config.ts';
import { reportError as report } from './report-error.ts';
import { didDocument, pdsEndpoint, pdsSupportsSpaces } from './identity.ts';

export type Did = `did:${string}:${string}`;
export type Agent = { handle(path: string, init?: RequestInit): Promise<Response> };
export type Auth<Rpc> = {
	did: Did | null;
	ready: boolean;
	handle: string | null;
	agent: Agent | null;
	rpc: Rpc | null;
	jamSpace: boolean;
	accountSync: boolean;
	privatePublishing: boolean;
	privateDeleting: boolean;
	uploadStorage: boolean;
	supporterDownloads: boolean;
	policyEditing: boolean;
	commenting: boolean;
	closing: boolean;
	reporting: boolean;
	moderating: boolean;
	error: string | null;
	scopeRejected: boolean;
};

export function createAuthState<Rpc>(config: AuthConfig, createRpc: (agent: Agent) => Rpc) {
	const { BASE_SCOPE_PARTS, SCOPE_PARTS, SYNC_SCOPE_PARTS, hasJamGrant, hasSyncGrant, hasPrivatePublishGrant, hasPrivateDeleteGrant, hasUploadGrant, hasDownloadGrant, hasPolicyGrant, hasCommentGrant, hasCloseGrant, hasReportGrant, hasModeratorGrant } = config;
	const initial: Auth<Rpc> = {
		did: null, ready: false, handle: null, agent: null, rpc: null,
		jamSpace: false, accountSync: false, privatePublishing: false, privateDeleting: false, uploadStorage: false, supporterDownloads: false, policyEditing: false, commenting: false, closing: false, reporting: false, moderating: false, error: null, scopeRejected: false
	};

	let state = initial;
	const listeners = new Set<() => void>();
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};

	function clearAuth(error: string | null = null, scopeRejected = false) {
		update({ ...initial, ready: true, error, scopeRejected });
	}

	function getAuth(): Auth<Rpc> {
		return state;
	}

	function setAuth(did: Did, agent: Agent, scope: string) {
		update({ ...initial, ready: true, did, agent, rpc: createRpc(agent), jamSpace: hasJamGrant(scope), accountSync: hasSyncGrant(scope), privatePublishing: hasPrivatePublishGrant(scope, did), privateDeleting: hasPrivateDeleteGrant(scope, did), uploadStorage: hasUploadGrant(scope), supporterDownloads: hasDownloadGrant(scope), policyEditing: hasPolicyGrant(scope), commenting: hasCommentGrant(scope), closing: hasCloseGrant(scope, did), reporting: hasReportGrant(scope), moderating: hasModeratorGrant(scope) });
		void didDocument(did).then(doc => {
			if (state.agent !== agent) return;
			update({ ...state, handle: doc.alsoKnownAs?.find(value => value.startsWith('at://'))?.slice(5) ?? null });
		}).catch(() => undefined);
	}

	function update(next: Auth<Rpc>) {
		state = next;
		// every subscriber hears every change: one that throws must not leave the rest on the old
		// account (a half-applied switch), nor fail the sign-in or switch that made the change
		for (const listener of listeners) {
			try { listener(); }
			catch (error) { report(error); }
		}
	}

	async function scopeFor(identifier: string, deviceOnly: boolean): Promise<string> {
		if (deviceOnly) return BASE_SCOPE_PARTS.join(' ');
		try {
			const did = identifier.startsWith('did:') ? identifier : await resolveHandle(identifier);
			if (typeof did === 'string' && await pdsSupportsSpaces(await pdsEndpoint(did))) return SCOPE_PARTS.join(' ');
		} catch {
			/* Space scopes are optional when capability discovery fails. */
		}
		return SYNC_SCOPE_PARTS.join(' ');
	}
	return { subscribe, initial, clearAuth, getAuth, setAuth, scopeFor };
}

export async function resolveHandle(handle: string): Promise<unknown> {
	const url = 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle';
	const response = await fetch(`${url}?handle=${encodeURIComponent(handle)}`);
	return response.ok ? (await response.json()).did : null;
}
