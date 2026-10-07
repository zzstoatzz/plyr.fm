import { browser } from '$app/environment';
import { API_URL } from '$lib/config';
import { audioContextCtor } from '$lib/audio/wav';
import {
	BANDS,
	BAND_Q,
	FLAT_GAINS,
	clampGain,
	headroomDb,
	isFlat,
	matchPreset,
	type Preset
} from '$lib/eq/bands';

const STORAGE_KEY = 'player_eq';
// short enough to feel instant, long enough to avoid zipper noise while dragging
const RAMP_SECONDS = 0.015;

interface StoredEq {
	enabled: boolean;
	gains: number[];
}

/** every iOS browser is WebKit, and WebKit stops a routed element when the screen locks. */
export function isIosWebKit(
	nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>
): boolean {
	if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
	return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
}

/** how to load `src` CORS-readable; credentialed sources ask the backend to serve the bytes itself. */
export interface CorsSource {
	src: string;
	crossOrigin: 'anonymous' | 'use-credentials' | null;
}

export function corsSource(
	src: string,
	credentialed: boolean,
	apiUrl: string = API_URL
): CorsSource {
	if (src.startsWith('blob:')) return { src, crossOrigin: null };
	if (!credentialed) return { src, crossOrigin: 'anonymous' };
	if (!src.startsWith(`${apiUrl}/audio/`)) return { src, crossOrigin: 'use-credentials' };
	const url = new URL(src);
	url.searchParams.set('cors', '1');
	return { src: url.toString(), crossOrigin: 'use-credentials' };
}

interface Graph {
	context: AudioContext;
	element: HTMLAudioElement;
	preamp: GainNode;
	filters: BiquadFilterNode[];
}

class EqState {
	enabled = $state(false);
	gains = $state<number[]>([...FLAT_GAINS]);
	/** the browser can route the player through web audio without breaking background play */
	supported = $state(false);
	/** the element is wired into the graph; from here on every source must load CORS-readable */
	routed = $state(false);

	preset = $derived<Preset | null>(matchPreset(this.gains));
	/** what the listener hears is actually shaped */
	shaping = $derived(this.enabled && !isFlat(this.gains));

	#graph: Graph | null = null;
	#lastSource: { src: string; credentialed: boolean } | null = null;

	constructor() {
		if (!browser) return;
		this.supported = 'AudioContext' in window && !isIosWebKit(navigator);
		this.#restore();
	}

	/** active means sources must load with crossorigin: on now, or routed earlier this session. */
	get active(): boolean {
		return this.supported && (this.enabled || this.routed);
	}

	/** call right before assigning a source: sets the element's crossorigin mode, returns the url to assign. */
	prepareSource(element: HTMLAudioElement, src: string, credentialed: boolean): string {
		this.#lastSource = { src, credentialed };
		if (!this.active) {
			if (element.crossOrigin !== null) element.crossOrigin = null;
			return src;
		}
		const next = corsSource(src, credentialed);
		if (element.crossOrigin !== next.crossOrigin) element.crossOrigin = next.crossOrigin;
		return next.src;
	}

	/** the element started playing: build the graph if the eq is on, and keep the context running. */
	onPlay(element: HTMLAudioElement) {
		if (!this.supported) return;
		if (this.enabled && !this.#graph) this.#route(element);
		const context = this.#graph?.context;
		if (context && context.state !== 'running') void context.resume().catch(() => {});
	}

	setEnabled(enabled: boolean, element: HTMLAudioElement | undefined) {
		if (!this.supported) return;
		this.enabled = enabled;
		this.#persist();
		if (enabled && element && !this.#graph) this.#routeLoaded(element);
		this.#apply();
	}

	setGain(index: number, db: number) {
		if (index < 0 || index >= BANDS.length) return;
		const next = [...this.gains];
		next[index] = clampGain(db);
		this.gains = next;
		this.#persist();
		this.#apply();
	}

	setGains(gains: readonly number[]) {
		this.gains = BANDS.map((_, i) => clampGain(gains[i] ?? 0));
		this.#persist();
		this.#apply();
	}

	get sampleRate(): number | undefined {
		return this.#graph?.context.sampleRate;
	}

	/** a source loaded without crossorigin plays silence once routed, so reload it readable in place. */
	#routeLoaded(element: HTMLAudioElement) {
		const current = element.currentSrc;
		const readable = !current || current.startsWith('blob:') || element.crossOrigin !== null;
		if (readable || !this.#lastSource) {
			if (current) this.#route(element);
			return;
		}
		const { src, credentialed } = this.#lastSource;
		const position = element.currentTime;
		const wasPlaying = !element.paused;
		const next = this.prepareSource(element, src, credentialed);
		element.addEventListener(
			'loadedmetadata',
			() => {
				if (Number.isFinite(position) && position > 0) element.currentTime = position;
				if (wasPlaying) void element.play().catch(() => {});
			},
			{ once: true }
		);
		element.src = next;
		element.load();
		this.#route(element);
	}

	#route(element: HTMLAudioElement) {
		if (this.#graph) return;
		try {
			const context = new (audioContextCtor())();
			const source = context.createMediaElementSource(element);
			const preamp = context.createGain();
			const filters = BANDS.map((band) => {
				const filter = context.createBiquadFilter();
				filter.type = band.kind;
				filter.frequency.value = band.frequency;
				if (band.kind === 'peaking') filter.Q.value = BAND_Q;
				return filter;
			});
			source.connect(preamp);
			filters.reduce<AudioNode>((prev, filter) => (prev.connect(filter), filter), preamp);
			filters[filters.length - 1].connect(context.destination);
			this.#graph = { context, element, preamp, filters };
			this.routed = true;
			this.#apply(true);
			if (context.state !== 'running') void context.resume().catch(() => {});
		} catch (err) {
			console.error('eq: could not route the player through web audio', err);
		}
	}

	#apply(immediate = false) {
		const graph = this.#graph;
		if (!graph) return;
		const gains = this.enabled ? this.gains : FLAT_GAINS;
		const now = graph.context.currentTime;
		const set = (param: AudioParam, value: number) => {
			if (immediate) param.value = value;
			else param.setTargetAtTime(value, now, RAMP_SECONDS);
		};
		graph.filters.forEach((filter, i) => set(filter.gain, gains[i] ?? 0));
		set(graph.preamp.gain, Math.pow(10, headroomDb(gains, graph.context.sampleRate) / 20));
	}

	#restore() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const stored: Partial<StoredEq> | null = JSON.parse(raw);
			this.enabled = stored?.enabled === true && this.supported;
			const gains = stored?.gains;
			if (Array.isArray(gains)) {
				this.gains = BANDS.map((_, i) => clampGain(Number(gains[i] ?? 0)));
			}
		} catch {
			// corrupt or blocked storage: keep the flat default
		}
	}

	#persist() {
		try {
			const stored: StoredEq = { enabled: this.enabled, gains: this.gains };
			localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
		} catch {
			// storage blocked: the eq still works for this session
		}
	}
}

export const eq = new EqState();
