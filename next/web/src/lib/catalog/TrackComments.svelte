<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Track, TrackComment } from '@plyr/next-core/api';
	import { clock } from '$lib/tracks';
	import { comments } from '$lib/listening/comments';
	import CommentComposer from '$lib/listening/CommentComposer.svelte';
	import { auth } from '$lib/auth';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';

	let { track, playFrom }: { track: Track; playFrom?: (seconds: number) => void } = $props();
	let snapshot = $state.raw(comments.snapshot());
	let account = $state.raw(auth.getAuth());
	let busy = $state(false);
	let error = $state('');
	let confirmRemoval = $state<string>();

	onMount(() => {
		const id = track.id;
		const unsubscribe = comments.subscribe(id, () => { snapshot = comments.snapshot(id); });
		const stopAuth = auth.subscribe(() => { account = auth.getAuth(); confirmRemoval = undefined; });
		comments.loadComments(id);
		return () => { unsubscribe(); stopAuth(); };
	});

	async function remove(comment: TrackComment) {
		if (busy || !account.commenting || account.did !== comment.author.did) return;
		error = '';
		busy = true;
		try {
			await comments.removeComment(track.id, comment);
			confirmRemoval = undefined;
		} catch {
			error = 'could not delete your comment. try again.';
		} finally { busy = false; }
	}
</script>

<CommentComposer {track} />
{#if error}<p role="alert" class="state">{error}</p>{/if}

{#if snapshot.loading}
	<Loading label="loading comments" inline />
{:else if snapshot.error}
	<p class="state">could not load comments. <button class="text-button" type="button" onclick={() => comments.loadComments(track.id)}>try again</button></p>
{/if}
{#if snapshot.comments.length}
	<ul>
		{#each snapshot.comments as comment (comment.record.uri)}
			<li>
				<div class="row-head">
					<a class="truncate" href={resolve('/(app)/u/[actor]', { actor: comment.author.did })}>{comment.author.display_name || comment.author.handle || 'listener'}</a>
					<button class="text-button time" type="button" disabled={!playFrom} aria-label={'Play from ' + clock(comment.timestamp_ms / 1000)} onclick={() => playFrom?.(comment.timestamp_ms / 1000)}>{clock(comment.timestamp_ms / 1000)}</button>
					{#if account.commenting && account.did === comment.author.did && confirmRemoval !== comment.record.uri}
						<button class="icon-button" type="button" aria-label="Delete comment" onclick={() => { confirmRemoval = comment.record.uri; }}><Icon name="trash" size={16} /></button>
					{/if}
				</div>
				<p>{comment.text}</p>
				{#if confirmRemoval === comment.record.uri}
					<div class="form-actions">
						<span>delete this comment?</span>
						<button class="text-button" type="button" disabled={busy} onclick={() => { confirmRemoval = undefined; }}>keep</button>
						<button class="text-button" type="button" disabled={busy} onclick={() => void remove(comment)}>delete</button>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{:else if !snapshot.loading && !snapshot.error}
	<p class="state">no comments yet.</p>
{/if}

<style>
	.form-actions, .row-head { display: flex; align-items: center; gap: 0.35rem; }
	.form-actions { justify-content: space-between; }
	.time { color: var(--accent); font-variant-numeric: tabular-nums; }
	ul { margin: 0; padding: 0; list-style: none; }
	li { padding-bottom: 0.5rem; border-bottom: 1px solid var(--line); }
	li p { white-space: pre-wrap; overflow-wrap: anywhere; }
	.row-head a { min-width: 0; font-weight: 650; }
</style>
