import type { GatedAudioSource } from './gated-audio-shared';

const prefix = '/__plyr_private_audio/';
const sources = new Map<string, GatedAudioSource>();
let registration: Promise<void> | undefined;
let listening = false;

function listen() {
	if (listening) return;
	listening = true;
	navigator.serviceWorker.addEventListener('message', event => {
		if (!event.source || !('scriptURL' in event.source) || event.source.scriptURL !== new URL('/private-audio-worker.js', location.origin).href
			|| event.data?.type !== 'plyr-private-audio-request') return;
		const port = event.ports[0];
		const id: unknown = event.data.id;
		const source = typeof id === 'string' ? sources.get(id) : undefined;
		if (!port) return;
		void (async () => {
			try {
				if (!source || typeof id !== 'string') throw new Error('released');
				const headers = await source.headers();
				if (sources.get(id) !== source) throw new Error('released');
				port.postMessage({ url: source.url, size: source.size, mimeType: source.mimeType, headers });
			} catch {
				port.postMessage({ error: 'unavailable' });
			} finally { port.close(); }
		})();
	});
	window.addEventListener('pagehide', event => {
		if (event.persisted) return;
		for (const id of sources.keys()) releasePrivateAudio(new URL(prefix + id, location.origin).href);
	});
}

async function prepare() {
	if (!('serviceWorker' in navigator)) throw new Error('protected streaming is not supported by this browser');
	listen();
	await navigator.serviceWorker.register('/private-audio-worker.js', { scope: '/', updateViaCache: 'none' });
	await navigator.serviceWorker.ready;
	if (navigator.serviceWorker.controller?.scriptURL === new URL('/private-audio-worker.js', location.origin).href) return;
	await new Promise<void>((resolve, reject) => {
		const finish = () => {
			if (navigator.serviceWorker.controller?.scriptURL !== new URL('/private-audio-worker.js', location.origin).href) return;
			clearTimeout(timer); navigator.serviceWorker.removeEventListener('controllerchange', finish); resolve();
		};
		const timer = setTimeout(() => {
			navigator.serviceWorker.removeEventListener('controllerchange', finish);
			reject(new Error('could not start protected streaming'));
		}, 10_000);
		navigator.serviceWorker.addEventListener('controllerchange', finish); finish();
	});
}

export async function privateAudioUrl(source: GatedAudioSource): Promise<string> {
	registration ??= new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('could not start protected streaming')), 10_000);
		void prepare().then(resolve, reject).finally(() => clearTimeout(timer));
	}).catch(error => { registration = undefined; throw error; });
	await registration;
	const id = crypto.randomUUID();
	sources.set(id, source);
	return new URL(prefix + id, location.origin).href;
}

export function releasePrivateAudio(uri: string) {
	const url = new URL(uri, location.origin);
	if (url.origin !== location.origin || !url.pathname.startsWith(prefix)) return;
	const id = url.pathname.slice(prefix.length);
	if (!sources.delete(id)) return;
	navigator.serviceWorker.controller?.postMessage({ type: 'plyr-private-audio-release', id });
}
