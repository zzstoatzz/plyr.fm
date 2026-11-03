<script lang="ts">
	import type { Track } from './api';
	import { auth } from './auth.svelte';
	import { like, myLikes, unlike } from './pds';
	import { toast } from './ui/toast.svelte';
	import Icon from './ui/Icon.svelte';

	let { track, size = 'md' }: { track: Track; size?: 'md' | 'lg' } = $props();
	let liked = $state(false);
	let busy = $state(false);

	$effect(() => {
		if (!auth.did) {
			liked = false;
			return;
		}
		const uri = track.record.uri;
		myLikes()
			.then((likes) => (liked = likes.has(uri)))
			.catch(() => {});
	});

	async function toggle() {
		if (!auth.did) {
			location.href = '/login';
			return;
		}
		busy = true;
		const was = liked;
		liked = !was;
		try {
			const status = was ? await unlike(track) : await like(track);
			if (status === 'rejected') toast.show('the appview rejected this like');
		} catch (e) {
			liked = was;
			toast.show((e as Error).message);
		} finally {
			busy = false;
		}
	}
</script>

<button
	class="btn ghost icon"
	class:lg={size === 'lg'}
	class:liked
	onclick={toggle}
	disabled={busy}
	aria-label={liked ? 'unlike' : 'like'}
	aria-pressed={liked}
>
	<Icon name={liked ? 'heart_f' : 'heart'} size={size === 'lg' ? 26 : 22} />
</button>

<style>
	.liked {
		color: var(--like);
	}
	button:disabled {
		opacity: 1;
	}
</style>
