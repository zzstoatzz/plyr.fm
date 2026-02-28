import { browser } from '$app/environment';
import { API_URL } from './config';
import { player } from './player.svelte';
import { queue } from './queue.svelte';
import { jam } from './jam.svelte';
import type { Device, QueueResponse } from './types';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30000;

function getBrowserDeviceName(): string {
	if (!browser) return 'unknown';
	const ua = navigator.userAgent;
	if (/iPhone/i.test(ua)) return 'iPhone';
	if (/iPad/i.test(ua)) return 'iPad';
	if (/Android/i.test(ua)) return 'Android';
	if (/Mac/i.test(ua)) return 'Mac';
	if (/Windows/i.test(ua)) return 'Windows';
	if (/Linux/i.test(ua)) return 'Linux';
	return 'Browser';
}

class DeviceManager {
	devices = $state<Device[]>([]);
	connected = $state(false);

	readonly deviceId: string;

	private ws: WebSocket | null = null;
	private reconnectTimer: number | null = null;
	private reconnectDelay = RECONNECT_BASE_MS;
	private heartbeatTimer: number | null = null;
	private visibilityHandler: (() => void) | null = null;

	otherDevices = $derived(this.devices.filter((d) => d.device_id !== this.deviceId));

	constructor() {
		if (browser) {
			const stored = localStorage.getItem('plyr_device_id');
			this.deviceId = stored ?? crypto.randomUUID();
			if (!stored) {
				localStorage.setItem('plyr_device_id', this.deviceId);
			}
		} else {
			this.deviceId = '';
		}
	}

	// -- ws lifecycle --------------------------------------------------------

	connect(): void {
		if (!browser) return;
		this.closeWs();

		const wsProtocol = API_URL.startsWith('https') ? 'wss' : 'ws';
		const wsBase = API_URL.replace(/^https?/, wsProtocol);
		const url = `${wsBase}/devices/ws`;

		this.ws = new WebSocket(url);

		this.visibilityHandler = () => {
			if (document.visibilityState === 'visible' && !this.connected) {
				this.connect();
			}
		};
		document.addEventListener('visibilitychange', this.visibilityHandler);

		this.ws.onopen = () => {
			this.connected = true;
			this.reconnectDelay = RECONNECT_BASE_MS;

			// register this device
			this.send({
				type: 'register',
				device_id: this.deviceId,
				name: getBrowserDeviceName()
			});

			this.startHeartbeat();
		};

		this.ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				this.handleMessage(data);
			} catch (error) {
				console.error('[devices] failed to parse ws message:', error);
			}
		};

		this.ws.onclose = () => {
			this.connected = false;
			this.stopHeartbeat();
			this.scheduleReconnect();
		};

		this.ws.onerror = () => {
			// onclose fires after onerror
		};
	}

	disconnect(): void {
		this.closeWs();
		this.devices = [];
	}

	transferTo(targetDeviceId: string): void {
		this.send({
			type: 'transfer',
			target_device_id: targetDeviceId
		});
	}

	// -- internals -----------------------------------------------------------

	private send(payload: Record<string, unknown>): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.warn('[devices] message dropped -- ws not open:', payload);
			return;
		}
		this.ws.send(JSON.stringify(payload));
	}

	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeatTimer = window.setInterval(() => {
			this.send({
				type: 'heartbeat',
				is_playing: !player.paused,
				current_track_id: queue.currentTrack?.file_id ?? null,
				progress_ms: Math.round(player.currentTime * 1000)
			});
		}, HEARTBEAT_INTERVAL_MS);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer !== null) {
			window.clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer !== null) return;

		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, this.reconnectDelay);

		this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
	}

	private closeWs(): void {
		if (this.visibilityHandler) {
			document.removeEventListener('visibilitychange', this.visibilityHandler);
			this.visibilityHandler = null;
		}
		if (this.reconnectTimer !== null) {
			window.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.stopHeartbeat();
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.onerror = null;
			this.ws.onmessage = null;
			this.ws.onopen = null;
			this.ws.close();
			this.ws = null;
		}
		this.connected = false;
	}

	// -- message handling ----------------------------------------------------

	private handleMessage(data: Record<string, unknown>): void {
		const msgType = data.type as string;

		if (msgType === 'devices_updated') {
			this.devices = (data.devices as Device[]) ?? [];
		} else if (msgType === 'transfer_in') {
			this.handleTransferIn(data);
		} else if (msgType === 'transfer_out') {
			queue.pause();
		} else if (msgType === 'error') {
			console.error('[devices] server error:', data.message);
		}
	}

	private handleTransferIn(data: Record<string, unknown>): void {
		// skip transfer if we're in a jam -- jam owns playback
		if (jam.active) return;

		const snapshot = data as unknown as QueueResponse;
		queue.applySnapshot(snapshot);

		if (typeof data.progress_ms === 'number') {
			queue.seek(data.progress_ms as number);
		}

		queue.play();
	}
}

export const devices = new DeviceManager();
