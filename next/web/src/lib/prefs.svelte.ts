import { type personalPreferenceSpace, type PersonalPreferences } from './preference-space';

export type Theme = 'system' | 'light' | 'dark';
export type Font = 'system' | 'mono' | 'serif';

/** the whole UI is in rem, so one root size scales text, icons, art and tap targets together */
export const SCALES = [
	{ value: 0.9, label: 'small' },
	{ value: 1, label: 'default' },
	{ value: 1.15, label: 'large' },
	{ value: 1.3, label: 'larger' }
] as const;

export const ACCENTS = ['#6a9fff', '#4ade80', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185', '#2dd4bf', '#f97316'];

export const FONTS: { value: Font; label: string; stack: string }[] = [
	{ value: 'system', label: 'system', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
	{ value: 'mono', label: 'mono', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
	{ value: 'serif', label: 'serif', stack: "ui-serif, 'New York', Georgia, 'Times New Roman', serif" }
];

interface Stored extends PersonalPreferences {
	volume: number;
}

type Remote = ReturnType<typeof personalPreferenceSpace>;
type Account = {
	did: string;
	remote: Remote | null;
	pending: Partial<PersonalPreferences>;
	busy: boolean;
	timer?: ReturnType<typeof setTimeout>;
};

const DEFAULTS: Stored = {
	theme: 'system',
	accent: ACCENTS[0],
	font: 'system',
	keepPlaying: false,
	playThrough: true,
	volume: 1,
	scale: 1
};

const KEY = 'plyr-next:prefs';

function load(): Stored {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
	} catch {
		/* private mode, or storage blocked */
	}
	return { ...DEFAULTS };
}

class Prefs {
	status = $state<'local' | 'syncing' | 'synced' | 'error'>('local');
	#account: Account | null = null;
	#s = $state<Stored>({ ...DEFAULTS });

	init() {
		this.#s = load();
		this.apply();
	}

	connect(did: string | null, remote: Remote | null) {
		if (this.#account?.timer) clearTimeout(this.#account.timer);
		const volume = this.#s.volume;
		this.#account = null;
		this.#s = { ...load(), volume };
		this.status = 'local';
		if (did) {
			const account: Account = { did, remote, pending: {}, busy: false };
			try {
				const cached = JSON.parse(localStorage.getItem(`${KEY}:${did}`) ?? 'null');
				if (cached) {
					this.#s = { ...this.#s, ...cached.preferences, volume };
					account.pending = cached.pending ?? {};
				}
			} catch {
				/* storage unavailable */
			}
			this.#account = account;
			if (remote) void this.sync();
		}
		this.apply();
	}

	async sync() {
		const account = this.#account;
		if (!account?.remote || account.busy) return;
		account.busy = true;
		this.status = 'syncing';
		const patch = account.pending;
		try {
			const remote = Object.keys(patch).length ? await account.remote.write(patch) : await account.remote.read();
			if (account !== this.#account) return;
			const remaining = { ...account.pending };
			for (const key of Object.keys(patch) as (keyof PersonalPreferences)[]) {
				if (remaining[key] === patch[key]) delete remaining[key];
			}
			account.pending = remaining;
			this.#s = { ...this.#s, ...remote, ...patch, ...remaining };
			this.#cache(account);
			this.apply();
			this.status = 'synced';
			if (Object.keys(remaining).length) this.#schedule(account);
		} catch {
			if (account === this.#account) this.status = 'error';
		} finally {
			account.busy = false;
		}
	}

	#schedule(account: Account) {
		this.status = 'syncing';
		clearTimeout(account.timer);
		account.timer = setTimeout(() => {
			if (account === this.#account) void this.sync();
		}, 300);
	}

	#cache(account: Account) {
		const { volume: _, ...preferences } = this.#s;
		try {
			localStorage.setItem(`${KEY}:${account.did}`, JSON.stringify({ preferences, pending: account.pending }));
		} catch {
			/* storage unavailable */
		}
	}

	get theme() {
		return this.#s.theme;
	}
	set theme(v: Theme) {
		this.#set({ theme: v });
	}
	get accent() {
		return this.#s.accent;
	}
	set accent(v: string) {
		this.#set({ accent: v });
	}
	get font() {
		return this.#s.font;
	}
	set font(v: Font) {
		this.#set({ font: v });
	}
	get keepPlaying() {
		return this.#s.keepPlaying;
	}
	set keepPlaying(v: boolean) {
		this.#set({ keepPlaying: v });
	}
	get playThrough() {
		return this.#s.playThrough;
	}
	set playThrough(v: boolean) {
		this.#set({ playThrough: v });
	}
	get scale() {
		return this.#s.scale;
	}
	set scale(v: number) {
		this.#set({ scale: v });
	}
	get volume() {
		return this.#s.volume;
	}
	set volume(v: number) {
		this.#set({ volume: Math.min(1, Math.max(0, v)) });
	}

	#set(patch: Partial<Stored>) {
		this.#s = { ...this.#s, ...patch };
		const account = this.#account;
		if (account && patch.volume === undefined) {
			account.pending = { ...account.pending, ...patch };
			this.#cache(account);
			if (account.remote) this.#schedule(account);
		} else {
			try {
				const local = patch.volume === undefined ? this.#s : { ...load(), volume: this.#s.volume };
				localStorage.setItem(KEY, JSON.stringify(local));
			} catch {
				/* storage unavailable */
			}
		}
		this.apply();
	}

	apply() {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		if (this.#s.theme === 'system') root.removeAttribute('data-theme');
		else root.dataset.theme = this.#s.theme;
		// percent of the browser's own default, so a user's system text size still counts
		root.style.fontSize = `${this.#s.scale * 100}%`;
		root.style.setProperty('--accent', this.#s.accent);
		root.style.setProperty('--accent-fg', readableOn(this.#s.accent));
		root.style.setProperty('--font', FONTS.find((f) => f.value === this.#s.font)?.stack ?? FONTS[0].stack);
	}
}

export const prefs = new Prefs();

/** black or white, whichever reads better on the accent (WCAG relative luminance). */
export function readableOn(hex: string): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return '#000000';
	const n = parseInt(m[1], 16);
	const lin = (c: number) => {
		const v = c / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
	return (1.05 / (l + 0.05)) > ((l + 0.05) / 0.05) ? '#ffffff' : '#000000';
}
