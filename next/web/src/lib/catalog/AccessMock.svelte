<script lang="ts">
	// MOCKUP ONLY (never merged): a dedicated "who can listen" page with a people picker.
	import type { Track } from '@plyr/next-core/api';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	let { track }: { track: Track } = $props();
	const av = (n: number) => `https://fx.invalid/av/${n}.jpg`;
	const picked = [{ name: 'Marcelo', handle: 'marcelo.bsky.social', a: 3 }, { name: 'clicker', handle: 'clicker.bsky.social', a: 5 }];
	const results: { name: string; handle: string; a: number }[] = [{ name: 'stellz', handle: 'stellz.bsky.social', a: 0 }, { name: 'Steph Okafor', handle: 'steph.okafor.dev', a: 6 }, { name: 'stereo lab tapes', handle: 'stereolabtapes.bsky.social', a: 7 }];
</script>

<header class="mobile-header"><span class="icon-button"><Icon name="back" /></span><b>who can listen</b><span></span></header>
<article class="page-content access-page">
	<a class="crumb" href="/track/{track.id}"><Icon name="back" size={16} /> {track.metadata.title}</a>
	<header class="top">
		<div class="thumb"><Artwork src={trackArtwork(track)} size={112} /></div>
		<div><h1>who can listen</h1><p>to {track.metadata.title}</p></div>
	</header>

	<div class="mode" role="radiogroup" aria-label="Who can listen">
		<button type="button" role="radio" aria-checked="false"><Icon name="users" size={20} /><span><b>everyone</b><small>anyone with the link, signed in or not</small></span></button>
		<button type="button" role="radio" aria-checked="true" class="on"><Icon name="lock" size={20} /><span><b>only some people</b><small>pick the ways in below</small></span></button>
	</div>

	<section class="ways" aria-label="Ways in">
		<div class="way open">
			<div class="way-head"><span class="check on"><Icon name="check" size={14} /></span><span><b>people you pick</b><small>2 people</small></span></div>
			<div class="picker">
				<div class="chips">
					{#each picked as p (p.handle)}<span class="chip"><img src={av(p.a)} alt="" />{p.name}<button type="button" aria-label={`Remove ${p.name}`}><Icon name="x" size={14} /></button></span>{/each}
				</div>
				<div class="search">
					<Icon name="search" size={18} />
					<span class="typed">ste<i></i></span>
				</div>
				<ul class="results" role="listbox" aria-label="People">
					{#each results as r, i (r.handle)}
						<li role="option" aria-selected={i === 0} class:hot={i === 0}><img src={av(r.a)} alt="" /><span><b>{r.name}</b><small>@{r.handle}</small></span><Icon name="plus" size={18} /></li>
					{/each}
				</ul>
			</div>
		</div>
		<div class="way">
			<div class="way-head"><span class="check on"><Icon name="check" size={14} /></span><span><b>your supporters</b><small>anyone who supports you through your support link</small></span></div>
		</div>
		<div class="way">
			<div class="way-head"><span class="check"></span><span><b>people who buy it</b><small>set a price and they get it once they pay</small></span></div>
		</div>
		<div class="way">
			<div class="way-head"><span class="check"></span><span><b>anyone signed in</b><small>keeps it off the open web</small></span></div>
		</div>
	</section>

	<p class="summary"><Icon name="lock" size={16} /> Marcelo, clicker and your supporters can listen. everyone else sees the cover and a way in.</p>
	<div class="save"><button type="button" class="hero-pill">cancel</button><button type="button" class="hero-pill primary">save</button></div>
</article>

<style>
	.mobile-header { display: none; }
	@media (max-width: 720px) { .mobile-header { padding: 0.35rem 0.5rem; display: grid; grid-template-columns: 2.75rem 1fr 2.75rem; align-items: center; text-align: center; border-bottom: 1px solid var(--line); background: var(--surface); } .crumb { display: none !important; } }
	.access-page { max-width: 40rem; display: grid; gap: 1.4rem; padding-top: clamp(1rem, 4vw, 2.5rem); padding-bottom: 6rem; }
	.crumb { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--muted); font-size: var(--t-14); justify-self: start; min-height: 2.75rem; }
	.top { display: flex; align-items: center; gap: 1rem; }
	.thumb { width: 4.5rem; border-radius: 0.5rem; overflow: hidden; flex: none; }
	.top h1 { font-size: clamp(1.6rem, 3vw, 2.2rem); letter-spacing: -0.03em; }
	.top p { margin: 0.15rem 0 0; color: var(--muted); }
	.mode { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
	.mode button, .way { border: 1.5px solid var(--line); border-radius: 0.9rem; background: var(--surface); color: var(--text); }
	.mode button { display: flex; align-items: flex-start; gap: 0.7rem; padding: 0.9rem 1rem; text-align: start; font: inherit; }
	.mode button.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
	.mode button.on :global(svg) { color: var(--accent); }
	.mode span, .way-head > span:last-child, .results span { display: grid; gap: 0.15rem; }
	small { color: var(--muted); font-size: var(--t-12-8); line-height: 1.35; }
	.ways { display: grid; gap: 0.6rem; }
	.way { padding: 0.9rem 1rem; display: grid; gap: 0.9rem; }
	.way.open { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); }
	.way-head { display: flex; align-items: flex-start; gap: 0.8rem; }
	.check { flex: none; width: 1.4rem; height: 1.4rem; margin-top: 0.05rem; border-radius: 0.4rem; border: 1.5px solid var(--faint); display: grid; place-items: center; }
	.check.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
	.picker { display: grid; gap: 0.6rem; padding-left: 2.2rem; }
	.chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
	.chip { display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.2rem 0.2rem 0.2rem 0.25rem; border-radius: 999px; background: var(--raised); font-weight: 600; font-size: var(--t-14); }
	.chip img { width: 1.6rem; height: 1.6rem; border-radius: 50%; object-fit: cover; }
	.chip button { display: grid; place-items: center; width: 1.9rem; height: 1.9rem; border: 0; border-radius: 50%; background: none; color: var(--muted); }
	.search { display: flex; align-items: center; gap: 0.55rem; min-height: 2.9rem; padding: 0 0.8rem; border: 1.5px solid var(--accent); border-radius: 0.7rem; background: var(--raised); color: var(--muted); }
	.typed { color: var(--text); display: inline-flex; align-items: center; }
	.typed i { display: inline-block; width: 1.5px; height: 1.1em; margin-left: 1px; background: var(--accent); }
	.results { list-style: none; margin: -0.3rem 0 0; padding: 0.3rem; border: 1px solid var(--line); border-radius: 0.7rem; background: var(--surface); box-shadow: 0 0.8rem 2rem rgb(0 0 0 / 0.18); }
	.results li { display: grid; grid-template-columns: 2.4rem minmax(0, 1fr) auto auto; align-items: center; gap: 0.7rem; min-height: 3.2rem; padding: 0 0.6rem; border-radius: 0.5rem; color: var(--muted); }
	.results li.hot { background: var(--hover); }
	.results img { width: 2.4rem; height: 2.4rem; border-radius: 50%; object-fit: cover; }
	.results b { color: var(--text); }
	.results em { font-style: normal; font-size: var(--t-12); color: var(--faint); }
	.summary { display: flex; align-items: flex-start; gap: 0.5rem; margin: 0; color: var(--muted); font-size: var(--t-14); line-height: 1.5; }
	.save { display: flex; justify-content: flex-end; gap: 0.5rem; }
	@media (max-width: 720px) {
		.mode { grid-template-columns: 1fr; }
		.picker { padding-left: 0; }
		.save { justify-content: stretch; } .save > * { flex: 1; }
		.top { display: none; }
	}
</style>
