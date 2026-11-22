import { parseSeen, seenKey } from '@plyr/next-core/behaviors/hints';
import { auth } from './auth';

export type HintId = 'now-playing.more-below' | 'queue.reorder';

/**
 * A one-time hint's seen state for the signed-in account (or signed-out visitor) on this device.
 * It reads as seen until the account is known, so a hint never flashes before it is ruled out.
 * Call it while a component initialises.
 */
export function oneTimeHint(id: HintId) {
	let seen = $state(true);
	let key: string | undefined;
	function read() {
		const account = auth.getAuth();
		if (!account.ready) return;
		const next = seenKey(account.did ?? null);
		if (next === key) return;
		key = next;
		try { seen = parseSeen(localStorage.getItem(next)).has(id); }
		catch { seen = true; }
	}
	$effect(() => { read(); return auth.subscribe(read); });
	return {
		get seen() { return seen; },
		dismiss() {
			if (seen) return;
			seen = true;
			if (!key) return;
			try {
				const stored = parseSeen(localStorage.getItem(key));
				stored.add(id);
				localStorage.setItem(key, JSON.stringify([...stored]));
			} catch {}
		},
	};
}
