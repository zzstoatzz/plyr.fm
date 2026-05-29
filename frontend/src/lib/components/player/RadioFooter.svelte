<script lang="ts">
	// footer player content while radio mode is active. the persistent radio
	// <audio> element + queue/radio coordination live in Player.svelte; this is
	// just the display + transport.
	import { radio } from '$lib/radio.svelte';
</script>

<div class="radio-content">
	<div class="radio-info">
		<svg
			class="radio-tower"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="2"></circle>
			<path
				d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"
			></path>
		</svg>
		<div class="radio-text">
			<span class="radio-station">radio.plyr.fm</span>
			{#if radio.current}
				<a class="radio-track" href="/u/{radio.current.artist_handle}"
					>{radio.current.title} · @{radio.current.artist_handle}</a
				>
			{:else}
				<span class="radio-track muted">tuning...</span>
			{/if}
		</div>
	</div>
	<div class="radio-controls">
		<button
			class="radio-toggle"
			onclick={() => radio.togglePlayPause()}
			aria-label={radio.playing ? 'pause radio' : 'play radio'}
		>
			{#if radio.playing}
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<rect x="6" y="5" width="4" height="14" rx="1"></rect>
					<rect x="14" y="5" width="4" height="14" rx="1"></rect>
				</svg>
			{:else}
				<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<polygon points="6 4 20 12 6 20 6 4"></polygon>
				</svg>
			{/if}
		</button>
		<button class="radio-stop" onclick={() => radio.stop()}>stop</button>
	</div>
</div>

<style>
	.radio-content {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.radio-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
	}

	.radio-tower {
		color: var(--accent);
		flex-shrink: 0;
	}

	.radio-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.radio-station {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.radio-track {
		font-size: var(--text-sm);
		color: var(--text-primary);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	a.radio-track:hover {
		color: var(--accent);
	}

	.radio-track.muted {
		color: var(--text-tertiary);
	}

	.radio-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.radio-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: var(--radius-full);
		border: none;
		background: var(--accent);
		color: var(--bg-primary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.radio-toggle:hover {
		background: var(--accent-hover);
	}

	.radio-stop {
		padding: 0.4rem 0.75rem;
		border-radius: var(--radius-base);
		border: 1px solid var(--border-default);
		background: transparent;
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all 0.15s;
	}

	.radio-stop:hover {
		border-color: var(--text-secondary);
		color: var(--text-primary);
	}
</style>
