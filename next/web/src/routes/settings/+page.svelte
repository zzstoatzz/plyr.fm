<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { ACCENTS, FONTS, prefs, SCALES, type Theme } from '$lib/prefs.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import ScreenHeader from '$lib/ui/ScreenHeader.svelte';

	const THEMES: Theme[] = ['system', 'light', 'dark'];
</script>

<ScreenHeader title="settings" subtitle="appearance and playback" />

<h2 class="section">appearance</h2>
<div class="group">
	<div class="setting">
		<span class="label">size</span>
		<div class="chips" role="radiogroup" aria-label="interface size">
			{#each SCALES as sc (sc.value)}
				<button class="chip" role="radio" aria-checked={prefs.scale === sc.value} onclick={() => (prefs.scale = sc.value)}>
					<span style:font-size="{sc.value}em">{sc.label}</span>
				</button>
			{/each}
		</div>
		<span class="hint">text, icons, artwork and buttons all scale together</span>
	</div>
	<div class="setting">
		<span class="label">theme</span>
		<div class="chips" role="radiogroup" aria-label="theme">
			{#each THEMES as t (t)}
				<button class="chip" role="radio" aria-checked={prefs.theme === t} onclick={() => (prefs.theme = t)}>{t}</button>
			{/each}
		</div>
	</div>
	<div class="setting">
		<span class="label">accent</span>
		<div class="swatches" role="radiogroup" aria-label="accent color">
			{#each ACCENTS as c (c)}
				<button
					class="swatch"
					style:--c={c}
					role="radio"
					aria-checked={prefs.accent === c}
					aria-label={c}
					onclick={() => (prefs.accent = c)}
				>
					{#if prefs.accent === c}<Icon name="check" size={16} stroke={3} />{/if}
				</button>
			{/each}
			<label class="swatch custom" style:--c={prefs.accent} title="pick any color">
				<input type="color" value={prefs.accent} oninput={(e) => (prefs.accent = (e.currentTarget as HTMLInputElement).value)} aria-label="custom accent color" />
				<Icon name="palette" size={16} />
			</label>
		</div>
	</div>
	<div class="setting">
		<span class="label">font</span>
		<div class="chips" role="radiogroup" aria-label="font">
			{#each FONTS as f (f.value)}
				<button class="chip" role="radio" aria-checked={prefs.font === f.value} style:font-family={f.stack} onclick={() => (prefs.font = f.value)}>{f.label}</button>
			{/each}
		</div>
	</div>
</div>

<h2 class="section">playback</h2>
<div class="list">
	<label class="row-item">
		<span class="grow">
			<span style="display:block">play through collections</span>
			<span class="muted small">playing a track from a list queues the rest of it</span>
		</span>
		<input type="checkbox" class="switch" checked={prefs.playThrough} onchange={(e) => (prefs.playThrough = (e.currentTarget as HTMLInputElement).checked)} />
	</label>
	<label class="row-item">
		<span class="grow">
			<span style="display:block">keep playing</span>
			<span class="muted small">when the queue runs out, continue with recent tracks</span>
		</span>
		<input type="checkbox" class="switch" checked={prefs.keepPlaying} onchange={(e) => (prefs.keepPlaying = (e.currentTarget as HTMLInputElement).checked)} />
	</label>
</div>

{#if auth.did}
	<p class="sync-status muted small" role="status">
		{#if prefs.status === 'syncing'}syncing preferences…
		{:else if prefs.status === 'synced'}preferences synced to your private space
		{:else if prefs.status === 'error'}preferences kept on this device · <button onclick={() => prefs.sync()}>retry sync</button>
		{:else}preferences kept on this device · <a href="/login">sign in again to enable sync</a>
		{/if}
	</p>
{/if}

<h2 class="section">account</h2>
<div class="list">
	{#if auth.did}
		<a class="row-item" href="/portal">
			<Icon name="portal" />
			<span class="grow">
				<span style="display:block">portal</span>
				<span class="muted small">your profile, tracks and playlists</span>
			</span>
			<span class="chev"><Icon name="chevron" size={18} /></span>
		</a>
		<a class="row-item" href="/u/{auth.handle ?? auth.did}">
			<Icon name="user" />
			<span class="grow">
				<span style="display:block">public profile</span>
				<span class="muted small">@{auth.handle ?? auth.did}</span>
			</span>
			<span class="chev"><Icon name="chevron" size={18} /></span>
		</a>
		<button class="row-item danger" onclick={() => auth.logout()}>
			<Icon name="logout" />
			<span class="grow">sign out</span>
		</button>
	{:else}
		<a class="row-item" href="/login">
			<Icon name="user" />
			<span class="grow">sign in</span>
			<span class="chev"><Icon name="chevron" size={18} /></span>
		</a>
	{/if}
</div>

<h2 class="section">about</h2>
<div class="list">
	<div class="row-item static">
		<Icon name="info" />
		<span class="grow muted small">
			next.plyr.fm reads the same fm.plyr records as plyr.fm through a read-only appview. everything you do here is written to your own PDS.
		</span>
	</div>
	<a class="row-item" href="https://plyr.fm" target="_blank" rel="noopener">
		<Icon name="link" />
		<span class="grow">plyr.fm</span>
	</a>
	<a class="row-item" href="https://github.com/zzstoatzz/plyr.fm/tree/main/next" target="_blank" rel="noopener">
		<Icon name="link" />
		<span class="grow">source</span>
	</a>
</div>

<style>
	.sync-status { padding-inline: var(--s-lg); }
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--s-lg);
		padding: var(--s-sm) var(--s-lg) var(--s-md);
	}
	.setting {
		display: flex;
		flex-direction: column;
		gap: var(--s-sm);
	}
	.label {
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--c-700);
	}
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-sm);
	}
	.swatch {
		position: relative;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 0;
		background: var(--c);
		color: #000;
		cursor: pointer;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.1);
	}
	.swatch[aria-checked='true'] {
		box-shadow:
			0 0 0 2px var(--c-0),
			0 0 0 0.25rem var(--c);
	}
	.custom {
		background: conic-gradient(#f87171, #fbbf24, #4ade80, #22d3ee, #818cf8, #f472b6, #f87171);
		color: #fff;
	}
	.custom input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.static {
		cursor: default;
		align-items: flex-start;
	}
	@media (hover: hover) {
		.static:hover {
			background: none;
		}
	}
	.danger {
		color: var(--negative);
	}
</style>
