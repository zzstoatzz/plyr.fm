<script lang="ts">
	import CollectionEmbed from '$lib/components/embed/CollectionEmbed.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<CollectionEmbed collection={data.collection} />
