import type { Agent } from './auth-state';
import { JAM_COORDINATOR_URL, JAM_JOIN_METHOD, JAM_SERVICE_AUDIENCE } from './auth-config';
import { hiddenTags } from './discovery/preferences';

export interface PersonalPreferences {
	theme: 'system' | 'light' | 'dark';
	accent: string;
	font: 'comic-sans' | 'system' | 'mono' | 'serif';
	keepPlaying: boolean;
	playThrough: boolean;
	scale: number;
	hiddenTags: string[];
}

export function decodePreferences(value: unknown): Partial<PersonalPreferences> {
	if (!value || typeof value !== 'object') return {};
	const v = value as Record<string, unknown>;
	const prefs: Partial<PersonalPreferences> = {};
	if (v.theme === 'system' || v.theme === 'light' || v.theme === 'dark') prefs.theme = v.theme;
	if (typeof v.accent === 'string' && /^#[0-9a-f]{6}$/i.test(v.accent)) prefs.accent = v.accent;
	if (v.font === 'comic-sans' || v.font === 'system' || v.font === 'mono' || v.font === 'serif') prefs.font = v.font;
	if (typeof v.keepPlaying === 'boolean') prefs.keepPlaying = v.keepPlaying;
	if (typeof v.playThrough === 'boolean') prefs.playThrough = v.playThrough;
	const hidden = hiddenTags(v.hiddenTags);
	if (hidden) prefs.hiddenTags = hidden;
	if (v.scale === 90 || v.scale === 100 || v.scale === 115 || v.scale === 130) prefs.scale = v.scale / 100;
	return prefs;
}

export function accountPreferences(agent: Agent, signal: AbortSignal) {
	async function call(patch?: Record<string, unknown>) {
		const identity = await agent.handle(`/xrpc/com.atproto.server.getServiceAuth?${new URLSearchParams({ aud: JAM_SERVICE_AUDIENCE, lxm: JAM_JOIN_METHOD })}`, { signal });
		const service: unknown = identity.ok ? await identity.json() : null;
		if (!service || typeof service !== 'object' || !('token' in service) || typeof service.token !== 'string') throw new Error('could not authorize settings');
		const response = await fetch(`${JAM_COORDINATOR_URL}/v1/preferences`, {
			method: 'POST', signal, headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ serviceToken: service.token, ...(patch ? { patch } : {}) })
		});
		const body: unknown = response.ok ? await response.json() : null;
		if (!body || typeof body !== 'object' || !('preferences' in body)) throw new Error('could not reach your settings');
		return decodePreferences(body.preferences);
	}

	return {
		read: () => call(),
		write({ scale, ...fields }: Partial<PersonalPreferences>) {
			return call({ ...fields, ...(scale === undefined ? {} : { scale: Math.round(scale * 100) }) });
		}
	};
}
