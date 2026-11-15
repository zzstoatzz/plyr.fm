<script lang="ts">
	import ListDetail from '$lib/ListDetail.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

{#key data.list.record.uri}<ListDetail list={data.list} />{/key}
