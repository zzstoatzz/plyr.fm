<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth, restoreAuth, takeLoginIntent } from '$lib/auth';
	import Loading from '$lib/ui/Loading.svelte';

	onMount(() => {
		void restoreAuth().then(() => goto(auth.getAuth().did ? takeLoginIntent() ?? '/settings' : '/login', { replaceState: true }));
	});
</script>

<Loading label="finishing sign-in" />
