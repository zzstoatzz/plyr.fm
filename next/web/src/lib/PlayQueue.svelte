<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { auth } from './auth';
	import { jamRoomPath, newJamPath } from './jam-room';
	import { player } from './player.svelte';
	import { artistName, clock, trackHref } from './tracks';
	import { trackArtwork } from '@plyr/next-core/artwork';
	import { explicitEnd } from '@plyr/next-core/queue-state';
	import { autoscrollVelocity, dragTarget, rowShift, type Row } from '@plyr/next-core/behaviors/reorder';
	import Artwork from './ui/Artwork.svelte';
	import Icon from './ui/Icon.svelte';
	import PlayingWave from './ui/PlayingWave.svelte';
	import QueueSuggestions from './QueueSuggestions.svelte';
	let { close }: { close?: () => void } = $props();
	let account = $state.raw(auth.getAuth());
	onMount(() => auth.subscribe(() => { account = auth.getAuth(); }));
	const deviceQueue = $derived(account.did && !account.accountSync && !player.privateMode && !player.jam && !player.liveStation);
	const start = $derived(player.index + 1);
	const queueState = $derived(player.snapshot.state);
	const tail = $derived(player.localMode ? undefined : queueState.tail);
	const end = $derived(tail ? Math.max(start, explicitEnd(queueState)) : player.queue.length);
	const picks = $derived(player.queue.slice(start, end));
	const continuation = $derived(player.queue.slice(end));
	const nothingNext = $derived(!picks.length && !(tail && continuation.length));
	const wash = $derived(player.current && !player.liveStation ? trackArtwork(player.current) : undefined);
	let pickList: HTMLOListElement | undefined = $state();
	let pendingPromotion: { key: string; opener: HTMLButtonElement } | undefined;

	function openJam() {
		const { did } = auth.getAuth();
		const path = player.jam ? jamRoomPath(player.jam.host, player.jam.key)
			: did && player.current ? newJamPath(did, player.current.id) : '/login?return_to=%2Fqueue';
		close?.();
		void goto(path);
	}

	function key(index: number) {
		return player.localMode ? index : queueState.entries[index]?.key ?? index;
	}

	function promotes(index: number) {
		return !!tail && index > start && (index === end || index === end + 1);
	}

	interface Drag { last: number; index: number; pointer: number; queue: typeof player.queue; y: number; scroll: number; offset: number; to: number; rows: Row[]; nodes: HTMLElement[]; from: number; scroller: HTMLElement; frame?: number; clientY: number }
	interface Press { index: number; pointer: number; x: number; y: number; touch: boolean; node: HTMLElement; timer?: ReturnType<typeof setTimeout> }
	let drag = $state.raw<Drag>();
	let press: Press | undefined;
	let suppressClickUntil = 0;
	let swipe: { index: number; pointer: number; queue: typeof player.queue; x: number; y: number } | undefined;

	function scrollerOf(node: HTMLElement) {
		return node.closest<HTMLElement>('aside') ?? document.scrollingElement as HTMLElement;
	}

	function pressStart(event: PointerEvent, index: number, handle = false) {
		if (event.button !== 0 || !event.isPrimary || index < start || drag || press) return;
		const target = event.target as Element;
		// A held touch may start on the cover or title too; a mouse drag starting there would fight the link and button.
		if (!handle && event.pointerType !== 'touch' && target.closest('button, a')) return;
		const node = event.currentTarget as HTMLElement;
		press = { index, pointer: event.pointerId, x: event.clientX, y: event.clientY, touch: event.pointerType === 'touch', node: node.closest('li') ?? node };
		if (handle) begin(event);
		else if (press.touch) press.timer = setTimeout(() => { if (press) { navigator.vibrate?.(10); begin(event); } }, 320);
	}

	function begin(event: PointerEvent) {
		const current = press;
		if (!current) return;
		clearTimeout(current.timer);
		const nodes = [...document.querySelectorAll<HTMLElement>('li.upcoming')];
		const from = nodes.findIndex(node => node === current.node);
		if (from < 0) return;
		const scroller = scrollerOf(current.node);
		const rects = nodes.map(node => node.getBoundingClientRect());
		const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
		try { current.node.setPointerCapture(current.pointer); } catch { /* the pointer already ended */ }
		swipe = undefined;
		// A pick stays among the picks; the queue would put it at the end of them anyway.
		const picksEnd = nodes.findLastIndex(node => Number(node.dataset.queueIndex) < end);
		const last = current.index < end && picksEnd >= 0 ? picksEnd : nodes.length - 1;
		drag = { last, index: current.index, from, to: from, pointer: current.pointer, queue: player.queue, y: current.y, clientY: event.clientY, scroll: scroller.scrollTop, offset: 0,
			rows: rects.map(rect => ({ top: rect.top, height: rect.height + gap })), nodes, scroller };
		press = undefined;
		drag.frame = requestAnimationFrame(autoscroll);
		track(event.clientY);
	}

	function pressMove(event: PointerEvent) {
		if (drag?.pointer === event.pointerId) { event.preventDefault(); track(event.clientY); return; }
		if (press?.pointer !== event.pointerId) return;
		if (!press.touch && !(event.buttons & 1)) { press = undefined; return; }
		const dx = event.clientX - press.x, dy = event.clientY - press.y;
		if (press.touch) { if (Math.hypot(dx, dy) > 8) { clearTimeout(press.timer); press = undefined; } return; }
		if (Math.abs(dy) > 6 && Math.abs(dy) > Math.abs(dx)) begin(event);
	}

	function track(clientY: number) {
		const current = drag;
		if (!current) return;
		if (current.queue !== player.queue) { endDrag(false); return; }
		const raw = clientY - current.y + current.scroller.scrollTop - current.scroll;
		const target = dragTarget(current.rows, current.from, raw);
		const offset = target.offset;
		const to = Math.min(target.to, current.last);
		if (to !== current.to) navigator.vibrate?.(5);
		drag = { ...current, offset, to, clientY };
	}

	function autoscroll() {
		const current = drag;
		if (!current) return;
		const bounds = current.scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : current.scroller.getBoundingClientRect();
		const velocity = autoscrollVelocity(current.clientY, bounds.top, bounds.bottom);
		if (velocity) { current.scroller.scrollTop += velocity; track(current.clientY); }
		if (drag) drag.frame = requestAnimationFrame(autoscroll);
	}

	function pressEnd(event: PointerEvent, apply: boolean) {
		if (press?.pointer === event.pointerId) { clearTimeout(press.timer); press = undefined; }
		if (drag?.pointer === event.pointerId) endDrag(apply);
	}

	function endDrag(apply: boolean) {
		const current = drag;
		drag = undefined;
		if (!current) return;
		if (current.frame !== undefined) cancelAnimationFrame(current.frame);
		suppressClickUntil = performance.now() + 350;
		if (apply && current.to !== current.from && player.queue === current.queue) {
			const target = Number(current.nodes[current.to]?.dataset.queueIndex);
			if (Number.isInteger(target)) player.move(current.index, target);
		}
	}

	function shift(index: number) {
		const current = drag;
		if (!current) return '';
		const at = current.nodes.findIndex(node => Number(node.dataset.queueIndex) === index);
		if (at < 0) return '';
		const y = at === current.from ? current.offset : rowShift(current.rows, current.from, current.to, at);
		return y ? `transform: translateY(${y}px)${at === current.from ? ' scale(1.02)' : ''}` : at === current.from ? 'transform: scale(1.02)' : '';
	}

	function holdScroll(node: HTMLElement) {
		const stop = (event: TouchEvent) => { if (drag) event.preventDefault(); };
		node.addEventListener('touchmove', stop, { passive: false });
		return { destroy: () => node.removeEventListener('touchmove', stop) };
	}

	function swipeStart(event: PointerEvent, index: number) {
		if (event.pointerType !== 'touch' || drag || (event.target as Element)?.closest('button, .drag-handle')) return;
		swipe = { index, pointer: event.pointerId, queue: player.queue, x: event.clientX, y: event.clientY };
	}

	function swipeEnd(event: PointerEvent, index: number) {
		const before = swipe;
		if (before?.pointer !== event.pointerId || drag) { swipe = undefined; return; }
		swipe = undefined;
		if (before.index !== index || index < start || before.queue !== player.queue) return;
		const distance = before.x - event.clientX;
		if (distance < 64 || distance <= Math.abs(event.clientY - before.y) * 1.5) return;
		suppressClickUntil = performance.now() + 350;
		player.remove(index);
	}

	function suppressSwipeClick(event: MouseEvent) {
		if (performance.now() >= suppressClickUntil || event.detail === 0) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		suppressClickUntil = 0;
	}

	function moveUp(index: number, opener: HTMLButtonElement) {
		const entryKey = key(index);
		if (typeof entryKey === 'string' && promotes(index) && document.activeElement === opener) {
			pendingPromotion = { key: entryKey, opener };
		}
		player.move(index, index - 1);
	}

	$effect(() => {
		const { entries } = queueState;
		const pending = pendingPromotion;
		if (!pending) return;
		const index = entries.findIndex(entry => entry.key === pending.key);
		if (index < start || index >= end) return;
		const target = pickList?.querySelector<HTMLButtonElement>(`[data-queue-key=${CSS.escape(pending.key)}] .cover`);
		if (document.activeElement === document.body || document.activeElement === pending.opener) target?.focus();
		pendingPromotion = undefined;
	});
</script>

<section aria-label="Queue" class="queue" class:rail={!!close}>
	{#if wash}<div class="wash" aria-hidden="true" style:--wash={`url("${wash}")`}></div>{/if}
	<header>
		<h1>queue</h1>
		<div class="actions">
			{#if player.jam || player.current && player.canEditPublicQueue}
				<button class="icon-button" type="button" aria-label={player.jam ? 'Open Jam' : 'Start a Jam'} title={player.jam ? 'Open Jam' : 'Start a Jam'} onclick={openJam}><Icon name="users" size={18} /></button>
			{/if}
			{#if player.current && !player.liveStation}
				<button class="icon-button" type="button" aria-label="shuffle up next" title="shuffle up next" disabled={picks.length < 2} onclick={() => player.shuffle()}><Icon name="shuffle" size={18} /></button>
				{#if picks.length}
					<button class="icon-button" type="button" aria-label="clear your queued tracks" title="clear your queued tracks" onclick={() => player.clear()}><Icon name="trash" size={18} /></button>
				{/if}
			{/if}
			{#if close}<button class="icon-button" type="button" aria-label="Close queue" onclick={close}><Icon name="x" size={18} /></button>{/if}
		</div>
	</header>
	{#if player.liveStation}
		<p class="state">you’re tuned to {player.liveStation.label} radio.</p>
		<button class="text-button" onclick={() => player.stopRadio()}>leave radio</button>
	{:else if player.current}
		{@const now = player.current}
		{@const nowPlaying = player.playing && !player.outputElsewhere}
		<section class="hero" aria-labelledby="queue-current">
			<button class="hero-cover" class:playing={nowPlaying} type="button" aria-label={`${nowPlaying ? 'Pause' : 'Play'} ${now.metadata.title}`} onclick={() => player.toggle()}>
				<Artwork src={trackArtwork(now)} size={160} eager />
				<span class="play hero-play"><Icon name={nowPlaying ? 'pause' : 'play'} size={26} /></span>
			</button>
			<div class="hero-meta">
				<h2 id="queue-current">{#if nowPlaying}<PlayingWave />{/if}now playing</h2>
				<a class="hero-title" href={trackHref(now)}>{now.metadata.title}</a>
				<a class="hero-artist truncate" href={resolve('/(app)/u/[actor]', { actor: now.artist.did })}>{artistName(now)}</a>
			</div>
		</section>
		{#if nothingNext && player.canEditPublicQueue && !player.jam}
			<QueueSuggestions empty />
		{:else if nothingNext}
			<p class="empty">add a track to hear it next.</p>
		{:else}
		<div class="glass">
		<section aria-labelledby="queue-picks">
			<div class="queue-head">
				<h2 id="queue-picks">up next</h2>
				<span class="count">{picks.length}</span>
			</div>
			{#if picks.length + continuation.length > 1}<p class="hint"><span class="touch">hold a track to move it</span><span class="mouse">drag a track to move it</span></p>{/if}
			{#if picks.length}
				<ol role="list" bind:this={pickList} use:holdScroll>
					{#each picks as track, offset (key(start + offset))}
						{@render upcoming(track, start + offset)}
					{/each}
				</ol>
			{:else}
				<p class="empty">no tracks queued by you.</p>
			{/if}
		</section>
		{#if tail && continuation.length}
			<section aria-labelledby="queue-continuation">
				<h2 id="queue-continuation">{tail.label}</h2>
				<ol role="list" use:holdScroll>
					{#each continuation as track, offset (key(end + offset))}
						{@render upcoming(track, end + offset)}
					{/each}
				</ol>
			</section>
		{/if}
		</div>
		{#if player.canEditPublicQueue && !player.privateMode && !player.jam}<QueueSuggestions empty={false} />{/if}
		{/if}
	{:else if player.canEditPublicQueue && !player.jam}
		<QueueSuggestions empty />
	{:else}
		<p class="state">your queue is empty.</p>
		<a href={resolve('/')}>browse tracks</a>
	{/if}
	{#if deviceQueue}
		<p class="empty">your queue is saved on this device. <a class="queue-signin" href={resolve('/login?return_to=%2Fqueue')} onclick={close}>sign in again</a> to use it on other devices.</p>
	{/if}
	{#if !player.localMode && player.snapshot.queueError}<p class="state" role="status">{player.snapshot.queueError}</p>{/if}
	{#if player.jam?.error}<p class="state" role="status">{player.jam.error}</p>{/if}
</section>

{#snippet upcoming(track: NonNullable<typeof player.current>, index: number)}
	<li class="row upcoming" class:lifted={drag?.index === index} class:dragging={!!drag} style={shift(index)} data-queue-key={key(index)} data-queue-index={index}
		onclickcapture={suppressSwipeClick} oncontextmenu={event => { if (press?.touch || drag) event.preventDefault(); }}
		onpointerdown={event => { swipeStart(event, index); pressStart(event, index); }} onpointermove={pressMove}
		onpointerup={event => { pressEnd(event, true); swipeEnd(event, index); }} onpointercancel={event => { swipe = undefined; pressEnd(event, false); }}>
		{@render row(track, index)}
	</li>
{/snippet}

{#snippet row(track: NonNullable<typeof player.current>, index: number)}
		{@const promote = promotes(index)}
		<button class="cover" type="button" aria-label={`Play ${track.metadata.title}`} onclick={() => player.jump(index, true)}>
			<Artwork src={trackArtwork(track)} size={44} eager={index - player.index < 8} />
			<span class="play"><Icon name="play" size={18} /></span>
		</button>
		<div class="labels">
			<a class="truncate" href={trackHref(track)}>{track.metadata.title}</a>
			<span class="subtle truncate">{artistName(track)}</span>
		</div>
		<span class="subtle time">{clock(track.metadata.duration_seconds)}</span>
		<div class="actions">
			<span class="drag-handle" aria-hidden="true" onpointerdown={event => { event.stopPropagation(); pressStart(event, index, true); }}>⠿</span>
			<button class="icon-button move" type="button" aria-label={promote ? `Move ${track.metadata.title} into up next` : `Move ${track.metadata.title} up`} title={promote ? 'move into up next' : 'move up'} disabled={index === start} onclick={event => moveUp(index, event.currentTarget)}><Icon name="down" size={16} /></button>
			<button class="icon-button" type="button" aria-label={`Remove ${track.metadata.title}`} onclick={() => player.remove(index)}><Icon name="x" size={16} /></button>
		</div>
{/snippet}

<style>
	.queue { position: relative; isolation: isolate; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.1rem; container-type: inline-size; }
	.wash { position: absolute; z-index: -1; inset: 0; overflow: hidden; pointer-events: none; }
	.wash::before { content: ''; position: absolute; inset: -15%; background: var(--wash) center / cover; filter: blur(64px) saturate(1.1); opacity: 0.32; }
	/* opacity is a number, so light-dark() can't pick it (that left the wash at full strength) */
	:global(:root[data-theme='light']) .wash::before { opacity: 0.2; }
	@media (prefers-color-scheme: light) { :global(:root:not([data-theme='dark'])) .wash::before { opacity: 0.2; } }
	/* the queue page: the wash fills the page edge to edge, the content keeps the page's padding */
	.queue:not(.rail) .wash { inset: calc(-1 * clamp(1rem, 3vw, 2.25rem)); }
	.hero { display: flex; align-items: flex-end; gap: 0.9rem; min-width: 0; }
	.hero-cover { position: relative; flex: none; width: min(9.5rem, 40cqi); padding: 0; border: 0; border-radius: 0.75rem; background: none; box-shadow: 0 0.9rem 2.2rem rgb(0 0 0 / 0.35); }
	.hero-cover .play { border-radius: inherit; }
	@media (hover: hover) { .hero-cover:not(:hover, :focus-visible) .hero-play { opacity: 0; } }
	@media (hover: none) { .hero-cover.playing .hero-play { opacity: 0; } }
	.hero-meta { min-width: 0; display: grid; gap: 0.15rem; }
	.hero-meta h2 { display: flex; align-items: center; gap: 0.4rem; margin: 0; font-size: 0.75rem; color: var(--faint); font-weight: 600; }
	.hero-meta h2 :global(*) { color: var(--accent); }
	.hero-title { font-size: 1.3rem; font-weight: 700; line-height: 1.15; letter-spacing: -0.02em; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
	.hero-artist { color: var(--muted); font-size: 0.92rem; }
	.glass { display: grid; gap: 0.9rem; padding: 0.75rem 0.55rem 0.55rem; border-radius: 0.9rem; background: color-mix(in srgb, var(--surface) 62%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); }
	.glass h2, .glass .count, .glass .hint { padding-inline: 0.35rem; }
	.glass .row { border-color: transparent; background: none; }
	.glass .upcoming.lifted { background: var(--raised); }
	.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rail { padding: 1rem; }
	header, .queue-head { display: flex; justify-content: space-between; align-items: center; }
	.actions { display: flex; align-items: center; }
	h1 { font-size: 1.45rem; letter-spacing: -0.03em; }
	h2, .count { color: var(--muted); font-size: 0.87rem; font-weight: 650; }
	h2 { margin-block-end: 0.55rem; overflow-wrap: anywhere; }
	.count { margin-block-end: 0.55rem; font-variant-numeric: tabular-nums; }
	ol { display: grid; gap: 0.38rem; margin: 0; padding: 0; list-style: none; }
	.row { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem; min-width: 0; border: 1px solid var(--line); border-radius: 0.7rem; background: var(--raised); }
	.upcoming { touch-action: pan-y pinch-zoom; }
	.upcoming { -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; cursor: grab; }
	.upcoming.dragging { transition: transform 160ms ease; cursor: grabbing; }
	.upcoming.lifted { position: relative; z-index: 2; transition: none; border-color: var(--accent); box-shadow: 0 0.6rem 1.4rem rgb(0 0 0 / 0.25); }
	@media (prefers-reduced-motion: reduce) { .upcoming.dragging { transition: none; } }
	.drag-handle { display: grid; place-items: center; min-width: 2.25rem; height: 2.75rem; touch-action: none; cursor: grab; color: var(--muted); user-select: none; }
	.drag-handle:active { cursor: grabbing; }
	.cover { border: 0; padding: 0; width: 2.75rem; flex: none; border-radius: 0.35rem; background: none; position: relative; }
	.play { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.48); color: white; border-radius: inherit; }
	.cover:not(:hover, :focus-visible) .play { opacity: 0; }
	.labels { min-width: 0; flex: 1; display: grid; gap: 0.12rem; font-size: 0.9rem; }
	.labels > :first-child { font-weight: 650; }
	.labels span, .time { font-size: 0.75rem; }
	.time { font-variant-numeric: tabular-nums; }
	.move :global(svg) { transform: rotate(180deg); }
	/* move up is for keyboards; pointers drag the row or the handle */
	.move:not(:focus-visible) { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); }
	.queue-signin { color: var(--accent); text-decoration: underline; text-underline-offset: 0.2em; }
	.hint { margin: -0.3rem 0 0.5rem; color: var(--faint); font-size: 0.8rem; }
	.hint .touch { display: none; }
	@media (pointer: coarse) { .hint .touch { display: inline; } .hint .mouse { display: none; } }
	.empty { color: var(--muted); margin: 0; font-size: 0.88rem; }
</style>
