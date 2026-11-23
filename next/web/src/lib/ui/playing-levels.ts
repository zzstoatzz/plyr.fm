import { createWaveEasing, levelsAt, waveBars, type TrackWaveform } from '@plyr/next-core/track-waveform';
import { api } from '$lib/api';
import { player } from '$lib/player.svelte';

// One loop writes the playing track's bar heights to `--wave-0`…`--wave-3` on
// the root and marks it `data-live-wave` while they follow the audio; otherwise
// icons keep their canned motion (not measured yet, a broadcast, another device).

const waveforms = new Map<string, Promise<TrackWaveform | null>>();
const easing = createWaveEasing();
const targets = new Array<number>(waveBars).fill(0);
let users = 0;
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

function show(live: boolean) {
	const root = document.documentElement;
	if (live) {
		easing.heights.forEach((height, bar) => root.style.setProperty(`--wave-${bar}`, height.toFixed(3)));
		root.dataset.liveWave = '';
	} else if ('liveWave' in root.dataset) delete root.dataset.liveWave;
}

function tick(now: number) {
	frame = 0;
	const snapshot = player.embedSnapshot();
	follow(snapshot.track?.uri);
	const live = !!waveform && snapshot.state === 'playing' && !player.airingBroadcast;
	if (live) easing.step(levelsAt(waveform!, snapshot.position, targets), last ? (now - last) / 1000 : 0);
	show(live);
	last = now;
	schedule();
}

function schedule() {
	if (!frame && users > 0 && document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
}

function visibility() {
	last = 0;
	schedule();
}

/** Keeps the loop running while an icon that follows the audio is on screen. */
export function followPlayingLevels(): () => void {
	if (users++ === 0) document.addEventListener('visibilitychange', visibility);
	schedule();
	return () => {
		if (--users > 0) return;
		document.removeEventListener('visibilitychange', visibility);
		cancelAnimationFrame(frame);
		frame = 0;
		last = 0;
		show(false);
	};
}
