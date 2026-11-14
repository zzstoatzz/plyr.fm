<script lang="ts">
	import ListDetail from '$lib/ListDetail.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<ListDetail list={data.list} />
