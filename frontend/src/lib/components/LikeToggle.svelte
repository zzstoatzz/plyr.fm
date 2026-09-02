<script lang="ts">
	import { likes } from '$lib/likes.svelte';
	import type { Track } from '$lib/types';

	interface Props {
		track: Track;
		size?: number;
	}

	let { track, size = 18 }: Props = $props();

	const liked = $derived(likes.isLiked(track));
</script>

<button
	type="button"
	class="like-toggle"
	class:liked
	onclick={() => void likes.toggle(track)}
	aria-pressed={liked}
	aria-label={liked ? `unlike ${track.title}` : `like ${track.title}`}
	title={liked ? 'unlike' : 'like'}
>
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill={liked ? 'currentColor' : 'none'}
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<path
			d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
		></path>
	</svg>
</button>

<style>
	.like-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.4rem;
		background: transparent;
		border: none;
		border-radius: var(--radius-full);
		color: var(--text-tertiary);
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s,
			transform 0.15s;
	}

	.like-toggle:hover {
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.like-toggle.liked {
		color: var(--accent);
	}

	.like-toggle:active {
		transform: scale(0.92);
	}
</style>
