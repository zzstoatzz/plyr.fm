<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Track, TrackComment } from '@plyr/next-core/api';
	import { clock } from '$lib/tracks';
	import { commentAuthor, reachedComments } from '@plyr/next-core/timed-comments';
	import { postedAt } from '$lib/listening/format';
	import { player } from '$lib/player.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
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
	// the comment the playhead is passing, lit like on iOS
	const passing = $derived(player.current?.id === track.id && player.playing
		? reachedComments(snapshot.comments, comment => comment.timestamp_ms, player.position * 1000, undefined, 1)[0] : undefined);

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

{#if snapshot.loading}
	<Loading label="loading comments" inline />
{:else if snapshot.error}
	<p class="state">could not load comments. <button class="text-button" type="button" onclick={() => comments.loadComments(track.id)}>try again</button></p>
{/if}
{#if snapshot.comments.length}
	<ul>
		{#each snapshot.comments as comment (comment.record.uri)}
			{@const stamp = clock(comment.timestamp_ms / 1000)}
			<li class:passing={comment === passing}>
				<button class="time" type="button" disabled={!playFrom} aria-label={'Play from ' + stamp} onclick={() => playFrom?.(comment.timestamp_ms / 1000)}>{stamp}</button>
				<div class="body">
					<div class="row-head">
						<span class="face"><Artwork src={comment.author.avatar_url ?? undefined} size={22} fallbackIcon="user" /></span>
						<a class="truncate" href={resolve('/(app)/u/[actor]', { actor: comment.author.did })}>{commentAuthor(comment)}</a>
						<span class="ago">{postedAt(comment.created_at)}</span>
					</div>
					<p>{comment.text}</p>
					{#if confirmRemoval === comment.record.uri}
						<div class="confirm">
							<span>delete this comment?</span>
							<button class="text-button danger" type="button" disabled={busy} onclick={() => void remove(comment)}>{busy ? 'deleting…' : 'delete'}</button>
							<button class="text-button" type="button" disabled={busy} onclick={() => { confirmRemoval = undefined; }}>keep</button>
						</div>
					{/if}
				</div>
				{#if account.commenting && account.did === comment.author.did && confirmRemoval !== comment.record.uri}
					<button class="icon-button trash" type="button" aria-label="Delete comment" onclick={() => { confirmRemoval = comment.record.uri; }}><Icon name="trash" size={16} /></button>
				{/if}
			</li>
		{/each}
	</ul>
{:else if !snapshot.loading && !snapshot.error && !snapshot.enabled}
	<p class="state">the artist hasn’t turned on comments.</p>
{:else if !snapshot.loading && !snapshot.error}
	<p class="state">no comments yet.</p>
{/if}
{#if error}<p role="alert" class="state">{error}</p>{/if}
<CommentComposer {track} compact />

<style>
	ul { display: grid; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
	/* one row per comment, as on iOS: the moment on the left, who and when, then what they said */
	li { display: flex; gap: 0.4rem; padding: 0.6rem; border-radius: 0.65rem; background: var(--surface); transition: background 0.2s; }
	li.passing { background: var(--raised); }
	.time { flex: none; align-self: flex-start; min-width: 2.75rem; min-height: 2.75rem; margin: -0.6rem 0 -0.6rem -0.3rem; padding: 0 0.25rem; border: 0; background: none; color: var(--accent); font-size: var(--t-12); font-weight: 700; font-variant-numeric: tabular-nums; }
	.time:disabled { color: var(--muted); opacity: 1; }
	.body { flex: 1; min-width: 0; display: grid; gap: 0.15rem; }
	.row-head { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
	.face { flex: none; width: 1.375rem; height: 1.375rem; border-radius: 50%; overflow: hidden; }
	.row-head a { min-width: 0; color: var(--text); font-size: var(--t-13-6); font-weight: 600; }
	.ago { margin-left: auto; flex: none; color: var(--faint); font-size: var(--t-12); }
	p { margin: 0; font-size: var(--t-14); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
	.state { color: var(--muted); }
	.confirm { display: flex; align-items: center; gap: 0.75rem; color: var(--muted); font-size: var(--t-13-6); }
	.danger { color: #ef4444; }
	.trash { flex: none; align-self: flex-start; width: 2.75rem; height: 2.75rem; margin: -0.6rem -0.4rem -0.6rem 0; color: var(--faint); }
	.trash:hover { color: #ef4444; }
</style>
