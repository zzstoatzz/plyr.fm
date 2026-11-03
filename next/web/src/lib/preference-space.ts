import type { OAuthUserAgent } from '@atcute/oauth-browser-client';
import { PREFERENCE_SPACE } from './config';

const POLICY = 'com.atproto.personalspace.policy';
const KEY = 'self';

export interface PersonalPreferences {
	theme: 'system' | 'light' | 'dark';
	accent: string;
	font: 'system' | 'mono' | 'serif';
	keepPlaying: boolean;
	playThrough: boolean;
	scale: number;
}

export function decodePreferences(value: unknown): Partial<PersonalPreferences> {
	if (!value || typeof value !== 'object') return {};
	const v = value as Record<string, unknown>;
	const prefs: Partial<PersonalPreferences> = {};
	if (v.theme === 'system' || v.theme === 'light' || v.theme === 'dark') prefs.theme = v.theme;
	if (typeof v.accent === 'string' && /^#[0-9a-f]{6}$/i.test(v.accent)) prefs.accent = v.accent;
	if (v.font === 'system' || v.font === 'mono' || v.font === 'serif') prefs.font = v.font;
	if (typeof v.keepPlaying === 'boolean') prefs.keepPlaying = v.keepPlaying;
	if (typeof v.playThrough === 'boolean') prefs.playThrough = v.playThrough;
	if (v.scale === 90 || v.scale === 100 || v.scale === 115 || v.scale === 130) prefs.scale = v.scale / 100;
	return prefs;
}

export function personalPreferenceSpace(agent: Pick<OAuthUserAgent, 'handle'>, did: string, signal: AbortSignal) {
	const space = `at://${did}/space/${PREFERENCE_SPACE.type}/${KEY}`;
	const record = { space, repo: did, collection: PREFERENCE_SPACE.collection, rkey: KEY };

	async function call(method: string, params: Record<string, string> | undefined, input?: unknown) {
		const query = params ? `?${new URLSearchParams(params)}` : '';
		const response = await agent.handle(
			`/xrpc/com.atproto.space.${method}${query}`,
			input === undefined
				? { method: 'GET', cache: 'no-store', signal }
				: { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }
		);
		const body = (await response.json().catch(() => ({}))) as {
			error?: string;
			policy?: { $type?: string };
			value?: unknown;
		};
		return { ...body, ok: response.ok };
	}

	async function describe() {
		const response = await call('getSpace', { space });
		if (!response.ok && response.error === 'SpaceNotFound') return false;
		if (!response.ok || response.policy?.$type !== POLICY) throw new Error('private preferences space unavailable');
		return true;
	}

	async function readRecord(): Promise<Record<string, unknown> | null> {
		const response = await call('getRecord', record);
		if (!response.ok && (response.error === 'RecordNotFound' || response.error === 'RepoNotFound')) return null;
		if (!response.ok || !response.value || typeof response.value !== 'object') throw new Error('could not read preferences');
		const value = response.value as Record<string, unknown>;
		if (value.$type !== PREFERENCE_SPACE.collection) throw new Error('unexpected preferences record type');
		return value;
	}

	return {
		async read() {
			return (await describe()) ? decodePreferences(await readRecord()) : {};
		},
		async write(patch: Partial<PersonalPreferences>) {
			if (!(await describe())) {
				const created = await call('createSpace', undefined, {
					spaceType: PREFERENCE_SPACE.type,
					skey: KEY,
					policy: { $type: POLICY }
				});
				if (!created.ok && created.error !== 'SpaceAlreadyExists') throw new Error('could not create private preferences space');
				if (!(await describe())) throw new Error('private preferences space unavailable');
			}
			const existing = await readRecord();
			const { scale, ...fields } = patch;
			const value = { ...existing, ...fields, $type: PREFERENCE_SPACE.collection, ...(scale === undefined ? {} : { scale: Math.round(scale * 100) }) };
			const response = await call('putRecord', undefined, {
				...record,
				record: value
			});
			if (!response.ok) throw new Error('could not save private preferences');
			return decodePreferences(value);
		}
	};
}
