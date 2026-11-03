<script lang="ts">
	import { artistName, player } from './player.svelte';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
</script>

{#if player.current}
	<div class="section"><span>now playing</span></div>
	<div class="item current">
		<Artwork src={player.current.media.artwork?.url} seed={player.current.metadata.title} size={40} />
		<div class="meta">
			<span class="ellipsis title">{player.current.metadata.title}</span>
			<span class="ellipsis small muted">{artistName(player.current)}</span>
		</div>
	</div>
{/if}
<div class="section">
	<span>up next</span>
	{#if player.upcoming.length}<button class="btn ghost sm" onclick={() => player.clearUpcoming()}>clear</button>{/if}
</div>
<ol class="plain">
	{#each player.upcoming as t, i (t.id + ':' + i)}
		{@const at = player.index + 1 + i}
		<li class="item">
			<button class="hit" onclick={() => player.jump(at)} aria-label="play {t.metadata.title}">
				<Artwork src={t.media.artwork?.url} seed={t.metadata.title} size={40} />
				<span class="meta">
					<span class="ellipsis title">{t.metadata.title}</span>
					<span class="ellipsis small muted">{artistName(t)}</span>
				</span>
			</button>
			<button class="btn ghost icon sm" onclick={() => player.removeAt(at)} aria-label="remove {t.metadata.title} from queue">
				<Icon name="x" size={16} />
			</button>
		</li>
	{:else}
		<li class="empty small">nothing queued. use "add to queue" on any track.</li>
	{/each}
</ol>

<style>
	.section {
		padding-top: var(--s-sm);
		font-size: var(--t-md);
	}
	.item {
		display: flex;
		align-items: center;
		gap: var(--s-md);
		padding: var(--s-xs) var(--s-sm) var(--s-xs) var(--s-lg);
	}
	.hit {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--s-md);
		padding: 0;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.title {
		font-weight: 600;
	}
	.current .title {
		color: var(--accent-text);
	}
</style>
