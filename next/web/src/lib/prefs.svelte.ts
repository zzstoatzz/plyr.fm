import type { Agent } from '@plyr/next-core/auth-state';
import { preferenceTransport } from '@plyr/next-core/preference-transport';
import { authConfig } from './auth-config';

const key = 'plyr-next:prefs';
export const themes = ['system', 'light', 'dark'] as const;
export const accents = [
	{ name: 'blue', color: '#6a9fff' },
	{ name: 'violet', color: '#c2a2ff' },
	{ name: 'green', color: '#66cd9d' },
	{ name: 'rose', color: '#f894b8' }
] as const;
export const scales = [
	{ name: 'compact', value: 0.9 },
	{ name: 'default', value: 1 },
	{ name: 'large', value: 1.15 },
	{ name: 'larger', value: 1.3 }
] as const;

type Preferences = {
	theme: typeof themes[number];
	accent: string;
	scale: number;
	playThrough: boolean;
	keepPlaying: boolean;
};

const defaults: Preferences = {
	theme: 'system', accent: accents[0].color, scale: 1, playThrough: true, keepPlaying: false
};
type Account = {
	key: string;
	controller: AbortController;
	request?: ReturnType<typeof preferenceTransport>;
	pending: Partial<Preferences>;
	busy: boolean;
};

export const prefs = $state({ ...defaults });
let account: Account | undefined;

function decode(value: unknown, remote = false): Partial<Preferences> {
	if (!value || typeof value !== 'object') return {};
	const { theme, accent, scale, playThrough, keepPlaying } = value as Record<string, unknown>;
	const result: Partial<Preferences> = {};
	if (theme === 'system' || theme === 'light' || theme === 'dark') result.theme = theme;
	if (typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent)) result.accent = accent.toLowerCase();
	if (typeof scale === 'number') {
		const value = remote ? scale / 100 : scale;
		if (remote ? scales.some(scale => scale.value === value) : value >= 0.9 && value <= 2) result.scale = value;
	}
	if (typeof playThrough === 'boolean') result.playThrough = playThrough;
	if (typeof keepPlaying === 'boolean') result.keepPlaying = keepPlaying;
	return result;
}

function read(key: string): Record<string, unknown> {
	try {
		const data: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
		if (data && typeof data === 'object') return data as Record<string, unknown>;
	} catch {}
	return {};
}

function write(key: string, value: object) {
	try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function apply(value: Partial<Preferences>) {
	Object.assign(prefs, value);
	const root = document.documentElement;
	if (prefs.theme === 'system') delete root.dataset.theme;
	else root.dataset.theme = prefs.theme;
	root.dataset.accent = prefs.accent;
	root.style.setProperty('--custom-accent', prefs.accent);
	root.style.fontSize = prefs.scale === 1 ? '' : `${prefs.scale * 100}%`;
}

async function sync() {
	const current = account;
	if (!current?.request || current.busy) return;
	current.busy = true;
	const patch = current.pending;
	try {
		const { scale, ...fields } = patch;
		const changed = Object.keys(patch).length > 0;
		const remote = decode(await current.request(changed ? { ...fields, ...(scale === undefined ? {} : { scale: Math.round(scale * 100) }) } : undefined), true);
		if (account !== current) return;
		const pending = { ...current.pending };
		for (const field of Object.keys(patch) as (keyof Preferences)[]) {
			if (pending[field] === patch[field]) delete pending[field];
		}
		current.pending = pending;
		apply({ ...remote, ...pending });
		write(current.key, { prefs, pending });
		current.busy = false;
		if (Object.keys(pending).length) void sync();
	} catch {
		current.busy = false;
	}
}

export function restorePrefs(did: string | null, agent: Agent | null, accountSync: boolean) {
	account?.controller.abort();
	account = undefined;
	const local = { ...defaults, ...decode(read(key)) };
	if (!did) {
		apply(local);
		return;
	}
	const cacheKey = `${key}:${did}`;
	const cached = read(cacheKey);
	const controller = new AbortController();
	account = {
		key: cacheKey, controller, pending: decode(cached.pending), busy: false,
		request: agent && accountSync ? preferenceTransport(agent, authConfig, controller.signal) : undefined
	};
	apply({ ...local, ...decode(cached.prefs), ...account.pending });
	void sync();
}

export function setPrefs(patch: Partial<Preferences>) {
	apply(patch);
	if (!account) {
		write(key, prefs);
		return;
	}
	account.pending = { ...account.pending, ...patch };
	write(account.key, { prefs, pending: account.pending });
	void sync();
}

export function mountPrefs() {
	window.addEventListener('online', sync);
	return () => {
		window.removeEventListener('online', sync);
		account?.controller.abort();
		account = undefined;
	};
}
