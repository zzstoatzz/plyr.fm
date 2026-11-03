// device-local preferences. prod keeps these in its database; next's appview
// is read-only, so they live here until a private (space) record syncs them.

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

interface Stored {
	theme: Theme;
	accent: string;
	font: Font;
	/** when a collection ends, keep going with the next thing in the feed */
	keepPlaying: boolean;
	/** playing from a list queues the rest of the list */
	playThrough: boolean;
	volume: number;
	scale: number;
}

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
	#s = $state<Stored>({ ...DEFAULTS });

	init() {
		this.#s = load();
		this.apply();
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
		try {
			localStorage.setItem(KEY, JSON.stringify(this.#s));
		} catch {
			/* not persisted; still applies for this visit */
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
