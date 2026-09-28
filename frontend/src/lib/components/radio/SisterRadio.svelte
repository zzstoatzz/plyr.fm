<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { API_URL } from '$lib/config';
	import { radio } from '$lib/radio.svelte';
	import { player } from '$lib/player.svelte';
	import { likes } from '$lib/likes.svelte';
	import { moderation } from '$lib/moderation.svelte';
	import { preferences } from '$lib/preferences.svelte';
	import { radioIntegration } from '$lib/sister-radio';
	import { resizedImageUrl, IMAGE_WIDTHS } from '$lib/utils/display-image';
	import type { RadioListeners } from '$lib/radio-presence';
	import type { mountRadio } from '../../../../vendor/sister-radio/host';

	let host: HTMLDivElement | undefined = undefined;
	let mounted = $state<ReturnType<typeof mountRadio> | null>(null);
	let origin = $state('');
	let failed = $state(false);
	let clock = $state(Date.now());
	const position = $derived(
		radio.active && !player.paused
			? player.currentTime
			: radio.state
				? Math.min(
						radio.current?.duration ?? 0,
						radio.state.progress_seconds +
							Math.max(0, (clock - Date.parse(radio.state.generated_at)) / 1000)
					)
				: 0
	);
	let listeners = $state<RadioListeners | null>(null);
	const selected = $derived(radio.state?.station_slug ?? radio.station ?? 'loved');
	const integration = $derived(
		radioIntegration({
			state: radio.state,
			stations: radio.stations,
			selected,
			playing: radio.active && !player.paused,
			liked: radio.current
				? likes.isLiked({ id: radio.current.id, is_liked: radio.current.liked })
				: false,
			position,
			volume: player.volume,
			loading: radio.loading,
			error: radio.error,
			listeners,
			origin,
			cover: (track) =>
				moderation.isSensitive(track.artwork_url) && !preferences.showSensitiveArtwork
					? ''
					: (resizedImageUrl(track.artwork_url, IMAGE_WIDTHS.hero) ?? ''),
			play: () => radio.tuneIn(),
			pause: () => player.audioElement?.pause(),
			setVolume: (value) => {
				player.volume = value;
			},
			selectStation: (slug) => {
				void goto(`/radio/${slug}`, { keepFocus: true, noScroll: true });
			},
			likeTrack: () => {
				const track = radio.current;
				if (track) void likes.toggle({ id: track.id, title: track.title, is_liked: track.liked });
			}
		})
	);
	$effect(() => {
		mounted?.update(integration);
	});
	$effect(() => {
		const slug = selected;
		const controller = new AbortController();
		let timer: number | undefined;
		listeners = null;
		async function refresh(): Promise<void> {
			try {
				const response = await fetch(`${API_URL}/radio/${encodeURIComponent(slug)}/listeners`, {
					signal: controller.signal
				});
				if (!response.ok) throw new Error('presence unavailable');
				const value: RadioListeners = await response.json();
				if (!controller.signal.aborted) listeners = value;
			} catch {
				if (!controller.signal.aborted) listeners = null;
			}
			if (!controller.signal.aborted) timer = window.setTimeout(refresh, 5000);
		}
		void refresh();
		return () => {
			controller.abort();
			window.clearTimeout(timer);
		};
	});
	onMount(() => {
		origin = window.location.origin;
		const tick = window.setInterval(() => {
			clock = Date.now();
		}, 1000);
		const poll = window.setInterval(() => {
			if (!radio.active) void radio.loadState();
		}, 30000);
		let cancelled = false;
		let dispose: (() => void) | undefined;
		void import('../../../../vendor/sister-radio/host')
			.then(({ mountRadio }) => {
				if (cancelled || !host) return;
				const instance = mountRadio(host, integration);
				dispose = instance.dispose;
				mounted = instance;
			})
			.catch(() => {
				if (!cancelled) failed = true;
			});
		return () => {
			cancelled = true;
			window.clearInterval(tick);
			window.clearInterval(poll);
			dispose?.();
		};
	});
</script>

{#if failed}<p role="alert">
		radio could not load. <button onclick={() => window.location.reload()}>try again</button>
	</p>{/if}
<div bind:this={host} class="sister-radio-host" aria-label="radio"></div>

<style>
	.sister-radio-host {
		width: 100%;
		min-width: 0;
	}
</style>
