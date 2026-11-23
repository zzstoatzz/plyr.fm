import { createWaveEasing, levelsAt, waveBars, type TrackWaveform } from '@plyr/next-core/track-waveform';
import { api } from '$lib/api';
import { player } from '$lib/player.svelte';

// One loop writes the playing track's bar heights to `--wave-0`…`--wave-3` on
// each following icon and marks it `data-live` (only those icons restyle); without
// that mark icons keep their canned motion (not measured yet, a broadcast, another device).

const waveforms = new Map<string, Promise<TrackWaveform | null>>();
const easing = createWaveEasing();
const targets = new Array<number>(waveBars).fill(0);
const icons = new Set<HTMLElement>();
let frame = 0;
let last = 0;
let uri: string | undefined;
let waveform: TrackWaveform | null = null;

function load(subject: string) {
	let pending = waveforms.get(subject);
	if (!pending) {
		pending = api.trackWaveform(subject).catch(() => {
			waveforms.delete(subject);
			return null;
		});
		waveforms.set(subject, pending);
	}
	return pending;
}

function follow(subject: string | undefined) {
	if (subject === uri) return;
	uri = subject;
	waveform = null;
	easing.reset();
	if (subject) void load(subject).then(found => { if (uri === subject) waveform = found; });
}

function show(icon: HTMLElement, live: boolean) {
	if (live) {
		easing.heights.forEach((height, bar) => icon.style.setProperty(`--wave-${bar}`, height.toFixed(3)));
		icon.dataset.live = '';
	} else if ('live' in icon.dataset) delete icon.dataset.live;
}

function tick(now: number) {
	frame = 0;
	const snapshot = player.embedSnapshot();
	follow(snapshot.track?.uri);
	const live = !!waveform && snapshot.state === 'playing' && !player.airingBroadcast;
	if (live) easing.step(levelsAt(waveform!, snapshot.position, targets), last ? (now - last) / 1000 : 0);
	for (const icon of icons) show(icon, live);
	last = now;
	schedule();
}

function schedule() {
	if (!frame && icons.size > 0 && document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
}

function visibility() {
	last = 0;
	schedule();
}

/** Drives `icon` from the levels while it is on screen. */
export function followPlayingLevels(icon: HTMLElement): () => void {
	if (icons.size === 0) document.addEventListener('visibilitychange', visibility);
	icons.add(icon);
	schedule();
	return () => {
		icons.delete(icon);
		show(icon, false);
		if (icons.size > 0) return;
		document.removeEventListener('visibilitychange', visibility);
		cancelAnimationFrame(frame);
		frame = 0;
		last = 0;
	};
}
