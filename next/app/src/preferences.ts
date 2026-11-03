import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Auth } from './auth-state';
import { personalPreferenceSpace, type PersonalPreferences } from './preference-space';
import { readLocal, writeLocal } from './storage';

export type Preferences = PersonalPreferences & { volume: number };
export type PreferenceStatus = 'local' | 'syncing' | 'synced' | 'error';

const KEY = 'plyr-next:prefs';
const DEFAULTS: Preferences = {
	theme: 'system', accent: '#6a9fff', font: 'system', keepPlaying: false, playThrough: true, volume: 1, scale: 1
};
type Account = {
	did: string;
	controller: AbortController;
	remote: ReturnType<typeof personalPreferenceSpace> | null;
	pending: Partial<PersonalPreferences>;
	busy: boolean;
	timer?: ReturnType<typeof setTimeout>;
};

function loadLocal(): Preferences {
	try {
		return { ...DEFAULTS, ...JSON.parse(readLocal(KEY) ?? '{}') };
	} catch {
		return DEFAULTS;
	}
}

export function usePreferences(auth: Auth) {
	const [preferences, setState] = useState(loadLocal);
	const [status, setStatus] = useState<PreferenceStatus>('local');
	const current = useRef(preferences);
	const active = useRef<Account | null>(null);
	const { did, agent, preferenceSpace } = auth;

	const apply = useCallback((value: Preferences) => {
		current.current = value;
		setState(value);
	}, []);

	function cache(account: Account) {
		const { volume: _, ...preferences } = current.current;
		writeLocal(`${KEY}:${account.did}`, JSON.stringify({ preferences, pending: account.pending }));
	}

	const sync = useCallback(async function syncNow(): Promise<void> {
		const account = active.current;
		if (!account?.remote || account.busy) return;
		account.busy = true;
		setStatus('syncing');
		const patch = account.pending;
		try {
			const remote = Object.keys(patch).length ? await account.remote.write(patch) : await account.remote.read();
			if (active.current !== account) return;
			const remaining = { ...account.pending };
			for (const key of Object.keys(patch) as (keyof PersonalPreferences)[]) {
				if (remaining[key] === patch[key]) delete remaining[key];
			}
			account.pending = remaining;
			apply({ ...current.current, ...remote, ...patch, ...remaining });
			cache(account);
			if (Object.keys(remaining).length) {
				clearTimeout(account.timer);
				account.timer = setTimeout(() => {
					if (active.current === account) void syncNow();
				}, 300);
			} else {
				setStatus('synced');
			}
		} catch {
			if (active.current === account) setStatus('error');
		} finally {
			account.busy = false;
		}
	}, [apply]);

	useEffect(() => {
		const local = loadLocal();
		setStatus('local');
		if (!did) {
			active.current = null;
			apply(local);
			return;
		}
		const controller = new AbortController();
		const remote = agent && preferenceSpace ? personalPreferenceSpace(agent, did, controller.signal) : null;
		const account: Account = { did, controller, remote, pending: {}, busy: false };
		let value = local;
		try {
			const cached = JSON.parse(readLocal(`${KEY}:${did}`) ?? 'null');
			if (cached) {
				value = { ...local, ...cached.preferences, volume: local.volume };
				account.pending = cached.pending ?? {};
			}
		} catch {
			/* Discard unreadable preference cache. */
		}
		active.current = account;
		apply(value);
		void sync();

		const resume = () => { void sync(); };
		const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') resume(); });
		if (typeof window !== 'undefined') {
			window.addEventListener?.('online', resume);
			window.addEventListener?.('focus', resume);
		}
		return () => {
			clearTimeout(account.timer);
			account.controller.abort();
			if (active.current === account) active.current = null;
			subscription.remove();
			if (typeof window !== 'undefined') {
				window.removeEventListener?.('online', resume);
				window.removeEventListener?.('focus', resume);
			}
		};
	}, [agent, apply, did, preferenceSpace, sync]);

	function setPreferences(patch: Partial<Preferences>) {
		apply({ ...current.current, ...patch });
		const { volume, ...fields } = patch;
		const account = active.current;
		if (!account) {
			writeLocal(KEY, JSON.stringify(current.current));
			return;
		}
		if (volume !== undefined) writeLocal(KEY, JSON.stringify({ ...loadLocal(), volume }));
		if (!Object.keys(fields).length) return;
		account.pending = { ...account.pending, ...fields };
		cache(account);
		if (account.remote) {
			setStatus('syncing');
			clearTimeout(account.timer);
			account.timer = setTimeout(() => {
				if (active.current === account) void sync();
			}, 300);
		}
	}

	return { preferences, setPreferences, status, sync };
}
