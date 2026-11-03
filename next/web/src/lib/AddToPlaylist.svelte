<script lang="ts">
	import { api, type ListSummary, type Track } from './api';
	import { auth } from './auth.svelte';
	import { addToPlaylist, createPlaylist } from './pds';

	let { track }: { track: Track } = $props();
	let open = $state(false);
	let mine = $state<ListSummary[] | null>(null);
	let name = $state('');
	let busy = $state(false);
	let note = $state<string | null>(null);

	async function toggle() {
		if (!auth.did) {
			location.href = '/login';
			return;
		}
		open = !open;
		if (open && mine === null) {
			try {
				mine = (await api.playlists({ owner_did: auth.did, limit: 100 })).data;
			} catch (e) {
				note = (e as Error).message;
				mine = [];
			}
		}
	}

	async function run(action: () => Promise<string>) {
		busy = true;
		note = null;
		try {
			const status = await action();
			note = status === 'indexed' ? 'added' : status === 'pending' ? 'saved to your PDS; indexing…' : status;
			mine = null;
			open = false;
		} catch (e) {
			note = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<span class="wrap">
	<button class="btn" onclick={toggle} disabled={busy} aria-expanded={open}>+ playlist</button>
	{#if open}
		<div class="menu" role="menu">
			{#if mine === null}
				<p class="muted">loading…</p>
			{:else}
				{#each mine as list (list.id)}
					<button role="menuitem" onclick={() => run(() => addToPlaylist(list.record.uri, track))} disabled={busy}>
						{list.metadata.name ?? 'untitled'}
					</button>
				{/each}
			{/if}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					if (name.trim()) run(async () => (await createPlaylist(name, track)).status);
				}}
			>
				<input bind:value={name} placeholder="new playlist" maxlength="64" aria-label="new playlist name" />
				<button class="btn" disabled={busy || !name.trim()}>create</button>
			</form>
		</div>
	{/if}
	{#if note}<small class="muted">{note}</small>{/if}
</span>

<style>
	.wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.menu {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 10;
		min-width: 14rem;
		margin-top: 0.25rem;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.menu > button {
		text-align: left;
		padding: 0.35rem 0.5rem;
		cursor: pointer;
	}
	form {
		display: flex;
		gap: 0.25rem;
		margin-top: 0.25rem;
	}
	input {
		flex: 1;
		min-width: 0;
	}
</style>
