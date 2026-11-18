import { embedProtocol, parseEmbedRequest, type EmbedEvent, type EmbedSnapshot, type EmbedAnalysisStatus } from '@plyr/next-core/embed-events';

export function mountEmbedEvents(read: () => EmbedSnapshot, analysis?: () => EmbedEvent['analysis'], options?: {
	live: () => boolean;
	status: () => EmbedAnalysisStatus;
	subscribed: (value: boolean) => void;
}) {
	let subscriber: { origin: string; subscription: string; hz: number } | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let sequence = 0;
	let lastHandshake = -Infinity;
	const send = () => {
		if (!subscriber) return;
		const measurement = analysis?.() ?? null;
		const event: EmbedEvent = {
			...read(), protocol: embedProtocol, type: 'snapshot', subscription: subscriber.subscription,
			sequence: ++sequence, clock: { epochMs: performance.timeOrigin + performance.now(), monotonicMs: performance.now() }, analysis: measurement, ...(options ? { analysisStatus: options.status() } : {})
		};
		window.parent.postMessage(event, subscriber.origin);
	};
	const stop = () => { clearInterval(timer); timer = undefined; subscriber = undefined; options?.subscribed(false); };
	const receive = (event: MessageEvent<unknown>) => {
		if (window.parent === window || event.source !== window.parent || event.origin === 'null') return;
		const request = parseEmbedRequest(event.data);
		if (!request) return;
		if (request.type === 'unsubscribe') {
			if (subscriber?.origin === event.origin && subscriber.subscription === request.subscription) stop();
			return;
		}
		const now = performance.now();
		if (now - lastHandshake < 100) return;
		lastHandshake = now;
		clearInterval(timer);
		subscriber = { origin: event.origin, subscription: request.subscription, hz: request.hz };
		sequence = 0;
		options?.subscribed(true);
		window.parent.postMessage({ protocol: embedProtocol, type: 'ready', subscription: request.subscription,
			capabilities: { playback: true, precomputed: false, live: options ? options.live() : !!analysis }, hz: request.hz }, event.origin);
		send();
		timer = setInterval(send, 1000 / request.hz);
	};
	window.addEventListener('message', receive);
	document.addEventListener('visibilitychange', send);
	return () => { stop(); window.removeEventListener('message', receive); document.removeEventListener('visibilitychange', send); };
}
