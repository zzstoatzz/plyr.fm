<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Track } from '@plyr/next-core/api';
	import { listenBlock, signInLabel } from '@plyr/next-core/listen-blocked';
	import { trackHref } from '$lib/tracks';

	let { message, track }: { message: string; track: Track } = $props();
	// "sign in to play this track" reads as itself, with its first words the way to sign in and come back here
	let label = $derived(signInLabel(listenBlock(message)));
</script>

{#if label}<a class="sign-in" href={resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: trackHref(track) })}>{label}</a>{message.slice(label.length)}{:else}{message}{/if}

<style>
	.sign-in { position: relative; pointer-events: auto; color: var(--accent); font-weight: 650; text-decoration: underline; text-underline-offset: 0.15em; }
</style>
