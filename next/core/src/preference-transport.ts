import type { Agent } from './auth-state.ts';
import type { createAuthConfig } from './auth-config.ts';

type Config = Pick<ReturnType<typeof createAuthConfig>, 'JAM_COORDINATOR_URL' | 'JAM_JOIN_METHOD' | 'JAM_SERVICE_AUDIENCE'>;

export function preferenceTransport(agent: Agent, config: Config, signal: AbortSignal) {
	return async (patch?: Record<string, unknown>): Promise<unknown> => {
		const auth = new URLSearchParams({ aud: config.JAM_SERVICE_AUDIENCE, lxm: config.JAM_JOIN_METHOD });
		const identity = await agent.handle(`/xrpc/com.atproto.server.getServiceAuth?${auth}`, { signal });
		const service: unknown = identity.ok ? await identity.json() : null;
		if (!service || typeof service !== 'object' || !('token' in service) || typeof service.token !== 'string') throw new Error('could not authorize settings');
		const response = await fetch(`${config.JAM_COORDINATOR_URL}/v1/preferences`, {
			method: 'POST', signal, headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ serviceToken: service.token, ...(patch ? { patch } : {}) })
		});
		const body: unknown = response.ok ? await response.json() : null;
		if (!body || typeof body !== 'object' || !('preferences' in body)) throw new Error('could not reach your settings');
		return body.preferences;
	};
}
