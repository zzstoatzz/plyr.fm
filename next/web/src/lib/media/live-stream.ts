import type { AudioSource } from './gated-audio';

type Hls = typeof import('hls.js').default;
let loading: Promise<Hls> | undefined;

/** Warms hls.js once a station says it is broadcasting, so tuning in does not wait on the chunk. */
export function preloadLiveStream(): Promise<Hls> {
	loading ??= import('hls.js').then(module => module.default).catch(error => { loading = undefined; throw error; });
	return loading;
}

/**
 * An endless HLS broadcast. Apple's WebKit plays HLS itself, and keeps doing so on the lock screen, so it gets the
 * playlist as the source. Everywhere else hls.js drives the element: Chrome answers "maybe" for HLS but cannot play it.
 */
export async function liveStream(url: string, audio: HTMLAudioElement, signal: AbortSignal): Promise<AudioSource> {
	if (navigator.vendor.startsWith('Apple') && audio.canPlayType('application/vnd.apple.mpegurl')) return { url };
	const Hls = await preloadLiveStream();
	signal.throwIfAborted();
	if (!Hls.isSupported()) throw new Error('this browser cannot play live radio');
	let hls: InstanceType<Hls> | undefined;
	return {
		url,
		attach(element) {
			const stream = hls = new Hls();
			stream.on(Hls.Events.ERROR, (_event, data) => {
				if (!data.fatal) return;
				if (data.type === Hls.ErrorTypes.NETWORK_ERROR) stream.startLoad();
				else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) stream.recoverMediaError();
				else element.dispatchEvent(new Event('error'));
			});
			stream.attachMedia(element);
			stream.loadSource(url);
		},
		release() {
			hls?.destroy();
			hls = undefined;
		}
	};
}
