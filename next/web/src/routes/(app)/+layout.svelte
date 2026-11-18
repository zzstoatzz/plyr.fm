<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth, restoreAuth } from '$lib/auth';
	import { player } from '$lib/player.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Toasts from '$lib/ui/Toasts.svelte';
	import LinksMenu from '$lib/LinksMenu.svelte';
	import { accountAvatar } from '$lib/api';
	import { mountPrefs, restorePrefs } from '$lib/prefs.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
	import AccountMenu from '$lib/account/AccountMenu.svelte';
	import { activeUploadCount } from '$lib/upload-activity.svelte';
	import { createDockPull } from '$lib/dock-pull';
	import '../../app.css';

	let { children } = $props();
	let dialog: HTMLDialogElement;
	let shortcutsDialog: HTMLDialogElement;
	let accountMenu = $state<{ open: (trigger: HTMLButtonElement) => void }>();
	let searchReturn: { url: URL; restoreFocus: () => void } | undefined;
	let cancelFocusRestore: (() => void) | undefined;
	const settingsPath = resolve('/(app)/settings');
	const queuePage = $derived(page.url.pathname === resolve('/queue'));
	const queuePanelOpen = $derived(player.queueOpen && !queuePage);
	let NowPlaying = $state<typeof import('$lib/NowPlaying.svelte').default>();
	let nowPlayingView = $state.raw<{ dismiss: () => void }>();
	const hideNowPlaying = () => { player.nowPlaying = false; };
	let loadingNowPlaying: Promise<void> | undefined;
	function preloadNowPlaying() {
		if (NowPlaying || loadingNowPlaying) return;
		loadingNowPlaying = import('$lib/NowPlaying.svelte')
			.then(module => { NowPlaying = module.default; })
			.catch(hideNowPlaying)
			.finally(() => { loadingNowPlaying = undefined; });
	}
	const pull = createDockPull(() => player.openNowPlaying(), preloadNowPlaying);
	let account = $state.raw(auth.getAuth());
	let avatar = $state.raw<{ did: string; url: string }>();
	const did = $derived(account.did);
	$effect(() => {
		if (!did) return;
		const owner = did;
		const controller = new AbortController();
		void accountAvatar(owner, controller.signal).catch(() => undefined).then(url => {
			if (!controller.signal.aborted) avatar = url ? { did: owner, url } : undefined;
		});
		return () => controller.abort();
	});
	let uploading = $derived(activeUploadCount(account.did));
	const links = [
		{ path: '/', label: 'home', icon: 'home' },
		{ path: '/search', label: 'search', icon: 'search' },
		{ path: '/library', label: 'library', icon: 'library' }
	] as const;
	const keyboardGuide = [
		{ action: 'search', keys: ['⌘ or Ctrl', 'K'] },
		{ action: 'settings', keys: ['⌘ or Ctrl', ','] },
		{ action: 'queue', keys: ['Q'] },
		{ action: 'play or pause', keys: ['Space'] },
		{ action: 'seek back or forward 10 seconds', keys: ['←', '→'] },
		{ action: 'previous track or restart', keys: ['J'] },
		{ action: 'next track', keys: ['L'] },
		{ action: 'mute or unmute', keys: ['M'] }
	];

	beforeNavigate(() => cancelFocusRestore?.());
	afterNavigate(({ from, to }) => {
		if (from && dialog?.open) nowPlayingView?.dismiss();
		if (to?.url.pathname !== resolve('/search')) {
			if (searchReturn && searchReturn.url.href === to?.url.href) searchReturn.restoreFocus();
			searchReturn = undefined;
		}
	});

	onMount(() => {
		restorePrefs(account.did, account.agent, account.accountSync);
		const stopPrefs = mountPrefs();
		let resumed = account.rpc;
		const unsubscribe = auth.subscribe(() => {
			const next = auth.getAuth();
			if (account.did !== next.did || account.agent !== next.agent || account.accountSync !== next.accountSync) {
				restorePrefs(next.did, next.agent, next.accountSync);
			}
			account = next;
			if (resumed === account.rpc) return;
			resumed = account.rpc;
			const owner = account.did;
			const rpc = account.rpc;
			if (owner && account.uploadStorage) {
				void import('$lib/upload').then(({ uploadQueue }) => {
					if (auth.getAuth().rpc === rpc) return uploadQueue.resume(owner);
				}).catch(() => {});
			}
		});
		const stop = player.mount();
		void restoreAuth();
		return () => { cancelFocusRestore?.(); unsubscribe(); stop(); stopPrefs(); };
	});
	$effect(() => {
		// Queue snapshots, rather than the media clock, trigger checkpoint writes.
		player.snapshot.state;
		player.repeat;
		player.keepPlaying;
		untrack(() => player.save());
	});
	$effect(() => {
		if (player.nowPlaying && !NowPlaying) {
			preloadNowPlaying();
		} else if (player.nowPlaying && !dialog.open) {
			dialog.showModal();
			if (player.focusNowPlayingSheet) dialog.focus({ preventScroll: true });
		}
		else if (!player.nowPlaying && dialog.open) dialog.close();
	});

	function rememberFocus() {
		const opener = document.activeElement;
		if (!(opener instanceof HTMLElement) || opener === document.body) return () => {};
		const attribute = ['id', 'href', 'aria-label', 'name'].find(key => opener.getAttribute(key));
		const value = attribute && opener.getAttribute(attribute);
		const region = opener.closest('section[aria-labelledby]')?.getAttribute('aria-labelledby');
		const track = opener.closest('[data-track-id]')?.getAttribute('data-track-id');
		const prefix = (region ? `section[aria-labelledby=${CSS.escape(region)}] ` : '')
			+ (track ? `[data-track-id=${CSS.escape(track)}] ` : '');
		const selector = value && `${prefix}${opener.localName}[${attribute}=${CSS.escape(value)}]`;
		return () => {
			if (opener.isConnected) {
				opener.focus({ preventScroll: true });
				return;
			}
			if (!selector) return;
			const restore = (preventScroll: boolean) => {
				const matches = [...document.querySelectorAll<HTMLElement>(selector)].filter(node => node.getClientRects().length > 0);
				const target = matches.length === 1 ? matches[0] : undefined;
				target?.focus({ preventScroll });
				return document.activeElement === target;
			};
			if (restore(true)) return;
			const main = document.getElementById('main');
			if (!main) return;
			// A streamed route can render the opener after navigation completes.
			const observer = new MutationObserver(() => { if (restore(false)) cancel(); });
			const cancel = () => {
				observer.disconnect();
				document.removeEventListener('focusin', cancel);
				document.removeEventListener('pointerdown', cancel);
				cancelFocusRestore = undefined;
			};
			cancelFocusRestore = cancel;
			document.addEventListener('focusin', cancel, { once: true });
			document.addEventListener('pointerdown', cancel, { once: true });
			observer.observe(main, { childList: true, subtree: true });
		};
	}

	async function toggleSearch() {
		if (page.url.pathname === resolve('/search')) {
			if (page.state.shortcutSearch) {
				history.back();
				return;
			}
		} else {
			searchReturn = { url: new URL(page.url), restoreFocus: rememberFocus() };
			await goto(resolve('/search'), { state: { shortcutSearch: true } });
		}
		document.getElementById('search-query')?.focus();
	}

	let queueRequest = player.queueRequest;
	$effect(() => {
		if (player.queueRequest === queueRequest) return;
		queueRequest = player.queueRequest;
		untrack(() => { if (!queuePage && !player.queueOpen) toggleQueue(); });
	});

	function toggleQueue(fromShortcut = false) {
		if (queuePage) {
			if (!fromShortcut) return;
			player.queueOpen = false;
			if (page.state.toggledQueue) history.back();
			else void goto(resolve('/'), { replaceState: true });
		} else if (matchMedia('(max-width: 720px)').matches) {
			void goto(resolve('/queue'), { state: { toggledQueue: true } });
		} else {
			player.queueOpen = !player.queueOpen;
		}
	}

	function shortcuts(event: KeyboardEvent) {
		if (event.defaultPrevented || event.isComposing || event.altKey || document.querySelector('dialog[open], :popover-open')) return;
		const key = event.key.toLowerCase();
		if (event.repeat && key !== 'arrowleft' && key !== 'arrowright') return;
		if (event.ctrlKey || event.metaKey) {
			if (key === 'k') { event.preventDefault(); void toggleSearch(); }
			else if (key === ',') { event.preventDefault(); void goto(resolve('/settings')); }
			return;
		}
		if (key === 'escape' && page.url.pathname === resolve('/search') && page.state.shortcutSearch) {
			event.preventDefault();
			void toggleSearch();
			return;
		}
		const target = event.target;
		// The browser can dispatch a key from a just-closed dialog before restoring focus.
		const focused = target instanceof Element && !target.closest('dialog:not([open])') ? target : undefined;
		if (focused?.closest('input, select, textarea, [role="slider"], [contenteditable]:not([contenteditable=false])')) return;
		if (key === '?') { event.preventDefault(); shortcutsDialog.showModal(); return; }
		if (key === 'q') { event.preventDefault(); toggleQueue(true); return; }
		if (!player.current && !player.liveStation) return;
		if (event.code === 'Space' || key === ' ') {
			if (!focused?.closest('button, a, summary')) { event.preventDefault(); player.toggle(); }
			return;
		}
		if (player.liveStation) return;
		switch (key) {
			case 'arrowleft': event.preventDefault(); player.seek(player.position - 10); break;
			case 'arrowright': event.preventDefault(); player.seek(player.position + 10); break;
			case 'j': event.preventDefault(); player.previous(); break;
			case 'l': event.preventDefault(); void player.next(); break;
			case 'm': event.preventDefault(); player.toggleMute(); break;
		}
	}
</script>

<svelte:window onkeydown={shortcuts} />
<a class="skip" href="#main">skip to content</a>

<div data-testid="app-frame" class="frame" class:hasPlayer={!!player.current} class:docked={queuePanelOpen}>
	<nav aria-label="Main navigation">
		<div class="brand-row"><LinksMenu /><a class="brand" aria-label="plyr.fm home" href="/">plyr.fm</a></div>
		{#each links as link (link.path)}
			<a href={link.path} class:active={page.url.pathname === link.path} aria-current={page.url.pathname === link.path ? 'page' : undefined}>
				<Icon name={link.icon === 'home' && page.url.pathname === '/' ? 'home_f' : link.icon} size={21} /> <span>{link.label}</span>
			</a>
		{/each}
		{#if account.did}
			<a href="/upload" class="desktop-only" class:active={page.url.pathname === '/upload'} aria-current={page.url.pathname === '/upload' ? 'page' : undefined}>
				<Icon name="upload" size={21} /><span>{uploading ? `uploading ${uploading}` : 'upload'}</span>
			</a>
		{/if}
		{#if account.did}
			<a href={resolve('/(app)/portal')} class="desktop-only" class:active={page.url.pathname === '/portal'} aria-current={page.url.pathname === '/portal' ? 'page' : undefined}>
				<span class="profile-avatar"><Artwork src={avatar?.did === did ? avatar?.url : undefined} size={24} fallbackIcon="user" eager /></span><span>you</span>
			</a>
			<button type="button" class="mobile-account" aria-haspopup="dialog" class:active={page.url.pathname === settingsPath} onclick={event => accountMenu?.open(event.currentTarget)}>
				<span class="profile-avatar"><Artwork src={avatar?.did === did ? avatar?.url : undefined} size={24} fallbackIcon="user" eager /></span><span>you</span>
			</button>
		{:else}
			<a href={resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: page.url.pathname + page.url.search })} class:active={page.url.pathname === '/login'}><Icon name="user" size={21} /><span>sign in</span></a>
		{/if}
		<div class="nav-spacer" aria-hidden="true"></div>
		<a class="desktop-radio" href="/radio" class:active={page.url.pathname === '/radio'}><Icon name="radio" size={21} /><span>radio</span></a>
		<a class="desktop-only" href={resolve('/(app)/atlas')} class:active={page.url.pathname === '/atlas'} aria-current={page.url.pathname === '/atlas' ? 'page' : undefined}><Icon name="music" size={21} /><span>atlas</span></a>
		<a class="desktop-stats" href={resolve('/(app)/stats')} class:active={page.url.pathname === '/stats'} aria-current={page.url.pathname === '/stats' ? 'page' : undefined}><Icon name="stats" size={21} /><span>stats</span></a>
		<a href={settingsPath} class="desktop-only" class:active={page.url.pathname === settingsPath} aria-current={page.url.pathname === settingsPath ? 'page' : undefined}><Icon name="settings" size={21} /><span>settings</span></a>
		<button class="desktop-help" type="button" onclick={() => shortcutsDialog.showModal()}><span aria-hidden="true">?</span> keyboard shortcuts</button>
	</nav>
	<main id="main" tabindex="-1">{@render children()}</main>
	{#if queuePanelOpen}
		<aside data-testid="queue-panel">
			{#await import('$lib/PlayQueue.svelte') then { default: Queue }}
				<Queue close={() => { player.queueOpen = false; }} />
			{/await}
		</aside>
	{/if}
</div>

{#if account.did}
	<AccountMenu bind:this={accountMenu} identity={account.handle ? '@' + account.handle : account.did} uploads={uploading} />
{/if}

<Toasts />
{#if player.current}
	{#await import('$lib/PlayerDock.svelte') then { default: Dock }}<Dock onQueue={toggleQueue} {queuePage} {pull} />{/await}
{/if}
<dialog bind:this={dialog} class="now-sheet" aria-label="Now playing" onclose={hideNowPlaying} oncancel={event => { event.preventDefault(); nowPlayingView?.dismiss(); }}>
	{#if player.nowPlaying && NowPlaying}<NowPlaying bind:this={nowPlayingView} close={hideNowPlaying} {pull} />{/if}
</dialog>
<dialog bind:this={shortcutsDialog} class="shortcuts" aria-labelledby="keyboard-guide-title">
	<header>
		<h2 id="keyboard-guide-title">keyboard shortcuts</h2>
		<form method="dialog"><button class="icon-button" type="submit" aria-label="Close keyboard shortcuts"><Icon name="x" /></button></form>
	</header>
	<dl>
		{#each keyboardGuide as shortcut (shortcut.action)}
			<div><dt>{shortcut.action}</dt><dd>{#each shortcut.keys as key (key)}<kbd>{key}</kbd>{/each}</dd></div>
		{/each}
	</dl>
</dialog>

<style>
	.frame { min-height: 100dvh; display: grid; grid-template-columns: var(--sidebar) minmax(0, 1fr); }
	.frame.hasPlayer { padding-bottom: var(--dock); }
	:global(body:has(.frame.hasPlayer)) { --toast-dock: var(--dock); }
	.frame.docked { grid-template-columns: var(--sidebar) minmax(0, 1fr) var(--queue); }
	nav { position: sticky; top: 0; align-self: start; min-height: 100dvh; display: flex; flex-direction: column; gap: 0.3rem; padding: 0.9rem; background: var(--surface); border-right: 1px solid var(--line); }
	nav a { display: flex; align-items: center; gap: 0.7rem; padding: 0.65rem 0.8rem; border-radius: 0.7rem; min-height: 2.75rem; color: var(--muted); }
	nav a:hover { text-decoration: none; background: var(--raised); }
	nav a.active { background: var(--hover); color: var(--text); font-weight: 650; }
	.brand-row { display: flex; align-items: center; min-height: 4rem; gap: 0.1rem; }
	nav .brand { font-weight: 750; font-size: 1.4rem; letter-spacing: -0.04em; color: var(--text); margin-bottom: 0.7rem; }
	.mobile-account { display: flex; align-items: center; gap: 0.7rem; min-height: 2.75rem; border: 0; border-radius: 0.7rem; background: none; padding: 0.65rem 0.8rem; text-align: start; color: var(--muted); }
	.mobile-account:hover { background: var(--raised); }
	.profile-avatar { width: 1.3125rem; border-radius: 50%; }
	.profile-avatar :global(svg) { width: 1.3125rem; height: 1.3125rem; }
	.desktop-help { display: flex; align-items: center; gap: 0.7rem; min-height: 2.75rem; border: 0; background: none; border-radius: 0.7rem; padding: 0.65rem 0.8rem; color: var(--muted); text-align: start; font-size: 0.875rem; }
	.desktop-help:hover { background: var(--raised); }
	.desktop-help span { width: 21px; text-align: center; font-size: 1.15rem; }
	main { min-width: 0; }
	aside { position: sticky; top: 0; align-self: start; min-width: 0; height: calc(100dvh - var(--dock)); overflow-y: auto; border-left: 1px solid var(--line); background: var(--surface); }
	dialog { width: min(36rem, calc(100% - 2rem)); max-height: calc(100dvh - 2rem); color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 1.2rem; padding: 0; }
	dialog::backdrop { background: rgb(0 0 0 / 0.65); }
	dialog.now-sheet { width: 100%; max-width: 100%; height: 100dvh; max-height: 100dvh; margin: 0; border: 0; border-radius: 0; }
	@media (min-width: 721px) {
		nav { height: calc(100dvh - var(--nav-dock, 0px)); min-height: 0; overflow-y: auto; padding: 0.875rem; gap: 0.25rem; }
		.frame.hasPlayer { --nav-dock: var(--dock); }
		nav a.brand { min-height: 4rem; margin: 0; padding-inline: 0; font-size: 1.8125rem; font-weight: 900; letter-spacing: -1px; }
		nav :is(a, .mobile-account) { min-height: 3rem; gap: 0.75rem; padding: 0 0.75rem; border-radius: 0.75rem; font-size: 0.96875rem; font-weight: 500; }
		nav a.active { font-weight: 700; }
		nav .mobile-account { display: none; }
		.nav-spacer { flex: 1; min-height: 1.5rem; }
		nav :is(.desktop-radio, .desktop-stats, a[href='/atlas'], a[href='/settings']) { min-height: 2.75rem; color: var(--faint); font-size: 0.875rem; font-weight: 400; }
		nav :is(.desktop-radio, .desktop-stats, a[href='/atlas'], a[href='/settings']).active { color: var(--text); font-weight: 600; }
		.desktop-help { min-height: 2.25rem; font-size: 0.75rem; color: var(--faint); }
	}
	.shortcuts { width: min(30rem, calc(100% - 2rem)); height: fit-content; max-height: calc(100dvh - 2rem); margin: auto; padding: 1rem 1.25rem; border: 1px solid var(--line); border-radius: 1rem; background: var(--surface); }
	.shortcuts header, .shortcuts dl div { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
	.shortcuts h2 { font-size: 1.2rem; }
	.shortcuts dl { margin: 0.45rem 0; }
	.shortcuts dl div { border-top: 1px solid var(--line); padding: 0.45rem 0; }
	.shortcuts dd { margin: 0; display: flex; gap: 0.25rem; flex-shrink: 0; }
	.shortcuts kbd { background: var(--raised); border: 1px solid var(--line); border-radius: 0.35rem; padding: 0.15rem 0.4rem; text-align: center; min-width: 1.65rem; font-size: 0.8rem; }
	@media (min-width: 721px) and (max-width: 1199px) {
		.frame.docked { grid-template-columns: var(--sidebar) minmax(0, 1fr); }
		aside { position: fixed; z-index: 8; right: 0; bottom: var(--dock); top: auto; height: auto; max-height: calc(100dvh - var(--dock)); width: min(var(--queue), calc(100vw - var(--sidebar))); box-shadow: 0 0 2rem rgb(0 0 0 / 0.15); }
	}
	@media (max-width: 720px) {
		.frame, .frame.docked { display: block; padding-bottom: calc(var(--tabs) + env(safe-area-inset-bottom)); }
		.frame.hasPlayer { padding-bottom: calc(var(--tabs) + var(--dock) + env(safe-area-inset-bottom)); }
		.brand-row, .nav-spacer, aside, nav .brand, nav .desktop-only, nav .desktop-radio, nav .desktop-stats, nav .desktop-help { display: none; }
		nav { z-index: 9; position: fixed; inset: auto 0 0; min-height: var(--tabs); flex-direction: row; padding: 0 0 env(safe-area-inset-bottom); border: 0; border-top: 1px solid var(--line); }
		nav :is(a, .mobile-account) { gap: 0.2rem; flex-direction: column; justify-content: center; flex: 1; min-height: var(--tabs); padding: 0.15rem; border-radius: 0; font-size: 0.75rem; }
		nav .mobile-account { display: flex; align-items: center; border: 0; background: none; color: var(--muted); -webkit-tap-highlight-color: transparent; }
		nav .mobile-account:focus-visible { outline-offset: -3px; }
		nav .mobile-account.active { background: var(--hover); color: var(--text); font-weight: 650; }
		dialog:not(.shortcuts) { width: 100%; max-width: 100%; height: 100dvh; max-height: 100dvh; margin: 0; border: 0; border-radius: 0; }
		dialog.now-sheet { background: transparent; overscroll-behavior: contain; }
		.now-sheet::backdrop { background: rgb(0 0 0 / var(--player-backdrop, 0.18)); }
	}
</style>
