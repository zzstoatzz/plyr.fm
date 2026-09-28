import { API_URL } from './config';

export interface RadioListener {
	did: string;
	handle: string;
	display_name: string;
	avatar_url: string | null;
}

export interface RadioListeners {
	count: number;
	listeners: RadioListener[];
}

export function connectRadioPresence(station: string): () => void {
	let socket: WebSocket | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let heartbeat: number | undefined;
	let stopped = false;
	let attempts = 0;
	const url = new URL(`${API_URL}/radio/${encodeURIComponent(station)}/listen`);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

	const connect = () => {
		if (stopped) return;
		const current = new WebSocket(url);
		socket = current;
		current.onopen = () => {
			if (stopped) {
				current.close();
				return;
			}
			attempts = 0;
			heartbeat = window.setInterval(() => {
				if (current.readyState === WebSocket.OPEN) current.send('ping');
			}, 20000);
		};
		current.onclose = (event) => {
			window.clearInterval(heartbeat);
			if (!stopped && event.code !== 4001 && event.code !== 1008) {
				retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempts++));
			}
		};
	};
	connect();
	return () => {
		stopped = true;
		clearTimeout(retry);
		window.clearInterval(heartbeat);
		socket?.close();
	};
}
