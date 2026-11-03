<script lang="ts">
	import type { Track } from './api';
	import { auth } from './auth.svelte';
	import { like, myLikes, unlike } from './pds';

	let { track }: { track: Track } = $props();
	let liked = $state(false);
	let busy = $state(false);
	let note = $state<string | null>(null);

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
		note = null;
		const was = liked;
		liked = !was;
		try {
			const status = was ? await unlike(track) : await like(track);
			if (status === 'rejected') note = 'the appview rejected this like';
			else if (status === 'pending') note = 'saved to your PDS; indexing…';
		} catch (e) {
			liked = was;
			note = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<button class="like" class:liked onclick={toggle} disabled={busy} title={note ?? (liked ? 'unlike' : 'like')} aria-pressed={liked}>
	{liked ? '♥' : '♡'}
</button>

<style>
	.like {
		background: none;
		border: 0;
		font-size: 1.15rem;
		cursor: pointer;
		color: var(--muted);
		padding: 0.25rem;
	}
	.like.liked {
		color: var(--accent);
	}
	.like:disabled {
		opacity: 0.6;
	}
</style>
