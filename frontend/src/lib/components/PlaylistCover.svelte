<script lang="ts">
	interface Props {
		/** explicit playlist cover — always wins when set */
		imageUrl?: string | null;
		/** distinct member-track artwork URLs, in playlist order */
		previews?: string[];
		alt?: string;
	}

	let { imageUrl = null, previews = [], alt = '' }: Props = $props();

	// spotify's rule: a 2x2 mosaic only at 4+ distinct artworks; below that,
	// the first track's artwork stands in for the whole cover
	const mosaic = $derived(!imageUrl && previews.length >= 4);
	const src = $derived(imageUrl ?? (previews.length > 0 ? previews[0] : null));
</script>

{#if mosaic}
	<div class="cover mosaic" role="img" aria-label={alt}>
		{#each previews.slice(0, 4) as url (url)}
			<img src={url} alt="" loading="lazy" />
		{/each}
	</div>
{:else if src}
	<img {src} {alt} class="cover" loading="lazy" />
{/if}

<style>
	.cover {
		width: 100%;
		height: 100%;
		display: block;
		object-fit: cover;
	}

	.mosaic {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
	}

	.mosaic img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		min-height: 0;
		min-width: 0;
	}
</style>
