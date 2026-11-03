<script lang="ts">
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import ListPage from '$lib/ListPage.svelte';
	const id = $derived(page.params.id!);
</script>

{#key id}<ListPage load={() => api.playlist(id)} />{/key}
