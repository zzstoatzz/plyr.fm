<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { Track, TrackComment } from '@plyr/next-core/api';
	import { player } from '$lib/player.svelte';
	import { clock } from '$lib/tracks';
	import Icon from '$lib/ui/Icon.svelte';
	import Loading from '$lib/ui/Loading.svelte';

	let { track, playFrom }: { track: Track; playFrom: (seconds: number) => void } = $props();
	let snapshot = $state.raw(comments.snapshot());
	let account = $state.raw(auth.getAuth());
	let draft = $state('');
	let pinned = $state<number>();
	let busy = $state(false);
	let error = $state('');
	let confirmRemoval = $state<string>();
	const position = $derived(!player.liveStation && player.current?.id === track.id ? player.position : 0);
	const seconds = $derived(pinned ?? position);
	const tooLong = $derived(new TextEncoder().encode(draft.trim()).length > MAX_COMMENT_BYTES);
	const signIn = $derived(resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: resolve('/(app)/track/[id]', { id: track.id }) }));

	onMount(() => {
		const id = track.id;
		const unsubscribe = comments.subscribe(id, () => { snapshot = comments.snapshot(id); });
		const stopAuth = auth.subscribe(() => { account = auth.getAuth(); confirmRemoval = undefined; });
		comments.loadComments(id);
		return () => { unsubscribe(); stopAuth(); };
	});

	async function post() {
		if (!account.commenting || !draft.trim() || busy || tooLong) return;
		error = '';
		busy = true;
		try {
			await comments.addComment(track, draft.trim(), seconds * 1000);
			draft = '';
			pinned = undefined;
		} catch {
			error = 'could not post your comment. try again.';
		} finally { busy = false; }
	}

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

<script lang="ts" module>
	import { createTrackComments, MAX_COMMENT_BYTES } from '@plyr/next-core/track-comments';
	import { api } from '$lib/api';
	import { auth } from '$lib/auth';
	import { createPds } from '$lib/pds';

	const comments = createTrackComments({ api, getAuth: auth.getAuth, createPds });
</script>

{#if account.commenting && track.record.cid}
	<form onsubmit={event => { event.preventDefault(); void post(); }}>
		<label for="track-comment-draft">add a comment</label>
		<textarea id="track-comment-draft" rows="2" maxlength={MAX_COMMENT_BYTES} bind:value={draft} disabled={busy}
			oninput={event => { if (event.currentTarget.value.trim()) pinned ??= position; else pinned = undefined; error = ''; }}></textarea>
		<div class="form-actions">
			<button type="button" class="text-button time" title="use the current playback position" onclick={() => { pinned = draft.trim() ? position : undefined; }}>at {clock(seconds)}</button>
			<button type="submit" class="text-button submit" disabled={busy || !draft.trim() || tooLong}>{busy ? 'posting…' : 'post comment'}</button>
		</div>
	</form>
{:else if track.record.cid}
	<p class="state"><a href={signIn}>{account.did ? 'reconnect' : 'sign in'}</a> to leave a comment</p>
{/if}
{#if error || tooLong}<p role="alert" class="state">{tooLong ? 'that comment is too long.' : error}</p>{/if}

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
					<button class="text-button time" type="button" aria-label={'Play from ' + clock(comment.timestamp_ms / 1000)} onclick={() => playFrom(comment.timestamp_ms / 1000)}>{clock(comment.timestamp_ms / 1000)}</button>
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
	form { display: grid; gap: 0.35rem; }
	textarea { width: 100%; min-height: 4rem; resize: vertical; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 0.65rem; padding: 0.55rem; font: inherit; font-size: max(1rem, 16px); }
	.form-actions, .row-head { display: flex; align-items: center; gap: 0.35rem; }
	.form-actions { justify-content: space-between; }
	.time, .state a { color: var(--accent); }
	.time { font-variant-numeric: tabular-nums; }
	.submit { background: var(--accent); color: var(--on-accent); font-weight: 650; }
	.submit:disabled { background: var(--raised); color: var(--muted); }
	ul { margin: 0; padding: 0; list-style: none; }
	li { padding-bottom: 0.5rem; border-bottom: 1px solid var(--line); }
	li p { white-space: pre-wrap; overflow-wrap: anywhere; }
	.row-head a { min-width: 0; font-weight: 650; }
</style>
