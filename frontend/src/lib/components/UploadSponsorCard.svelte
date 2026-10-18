<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { API_URL, getServerConfig } from '$lib/config';
	import { preferences } from '$lib/preferences.svelte';

	let { revision = 0 }: { revision?: number } = $props();
	let usage = $state<{ did: string; uploaded: number; scanned: number; threshold: number } | null>(
		null
	);
	let dismissedDid = $state<string | null>(null);
	const visible = $derived(
		auth.isAuthenticated &&
			preferences.data !== null &&
			usage !== null &&
			usage.did === auth.user?.did &&
			dismissedDid !== usage.did &&
			usage.uploaded > usage.threshold * 3600 &&
			Date.now() - (preferences.data.ui_settings.upload_sponsor_dismissed_at ?? 0) >
				30 * 24 * 60 * 60 * 1000
	);

	$effect(() => {
		const did = auth.user?.did;
		void revision;
		if (!did || !auth.isAuthenticated) return;
		const controller = new AbortController();
		void load(did, controller.signal);
		return () => controller.abort();
	});

	async function load(did: string, signal: AbortSignal): Promise<void> {
		try {
			const [response, config] = await Promise.all([
				fetch(`${API_URL}/tracks/me/upload-summary`, { credentials: 'include', signal }),
				getServerConfig(true)
			]);
			if (!response.ok) return;
			const data: { uploaded_audio_seconds: number; scanned_audio_seconds: number } =
				await response.json();
			if (signal.aborted) return;
			if (
				!Number.isFinite(data.uploaded_audio_seconds) ||
				!Number.isFinite(data.scanned_audio_seconds) ||
				!Number.isFinite(config.upload_sponsor_threshold_hours)
			)
				return;
			usage = {
				did,
				uploaded: data.uploaded_audio_seconds,
				scanned: data.scanned_audio_seconds,
				threshold: config.upload_sponsor_threshold_hours
			};
		} catch {
			// An optional support prompt must never interrupt uploading.
		}
	}

	function dismiss(): void {
		dismissedDid = auth.user?.did ?? null;
		void preferences.updateUiSettings({ upload_sponsor_dismissed_at: Date.now() });
	}
</script>

{#if visible && usage}
	<aside aria-label="support plyr.fm">
		<p>
			you’ve shared {(usage.uploaded / 3600).toFixed(1)} hours of audio.
			{#if usage.scanned > 0}
				copyright checks on your current uploads represent about ${(
					(usage.scanned / 3600) *
					1.5
				).toFixed(2)} in scanning costs at $1.50 per scanned hour, before plan allowances.
			{/if}
			help keep plyr.fm running by becoming a sponsor.
		</p>
		<div class="actions">
			<a href="https://github.com/sponsors/zzstoatzz" target="_blank" rel="noopener noreferrer"
				>sponsor plyr.fm</a
			>
			<button type="button" onclick={dismiss}>dismiss for 30 days</button>
		</div>
	</aside>
{/if}

<style>
	aside {
		padding: 1rem;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		margin-bottom: 1rem;
		background: var(--bg-tertiary);
	}
	p {
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.5;
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1.25rem;
		margin-top: 0.75rem;
	}
	a,
	button {
		font: inherit;
		font-size: var(--text-sm);
		padding: 0.5rem 0;
	}
	a {
		color: var(--accent);
	}
	button {
		color: var(--text-secondary);
		background: none;
		border: 0;
		cursor: pointer;
	}
</style>
