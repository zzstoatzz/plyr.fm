<script lang="ts">
	import type { AlbumMetadata, Track } from '$lib/types';

	let {
		album,
		tracks
	}: {
		album: Pick<AlbumMetadata, 'artist_handle' | 'slug' | 'show_plylst'>;
		tracks: Pick<Track, 'publishing'>[];
	} = $props();
	const visible = $derived(
		album.show_plylst &&
			tracks.length > 0 &&
			tracks.every(
				(track) =>
					track.publishing?.access.listening === 'public' &&
					track.publishing.access.visibility !== 'private'
			)
	);
</script>

{#if visible}
	<a
		class="plylst-link"
		href="https://plylst.renderg.host/u/{encodeURIComponent(
			album.artist_handle
		)}/album/{encodeURIComponent(album.slug)}"
		target="_blank"
		rel="noopener noreferrer"
		aria-label="open album in plylst (opens in a new tab)"
		title="open in plylst"
	>
		<img src="/integrations/plylst.svg" alt="" width="18" height="18" />
		<svg
			aria-hidden="true"
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"><path d="M7 17 17 7M7 7h10v10" /></svg
		>
	</a>
{/if}

<style>
	.plylst-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.5rem;
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		text-decoration: none;
	}
	.plylst-link:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
	@media (pointer: coarse) {
		.plylst-link {
			min-height: 44px;
			min-width: 44px;
		}
	}
</style>
