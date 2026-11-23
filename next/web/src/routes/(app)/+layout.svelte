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
	import { accountIdentity } from '$lib/api';
	import { mountPrefs, restorePrefs } from '$lib/prefs.svelte';
	import Artwork from '$lib/ui/Artwork.svelte';
	import AccountMenu from '$lib/account/AccountMenu.svelte';
	import PdsAudioSheet from '$lib/account/PdsAudioSheet.svelte';
	import { pdsAudio } from '$lib/account/pds-audio.svelte';
	import { activeUploadCount } from '$lib/upload-activity.svelte';
	import { createDockPull } from '$lib/dock-pull';
	import { navCollapsed, setNavCollapsed } from '$lib/nav';
	import '../../app.css';

	let { children } = $props();
	let dialog: HTMLDialogElement;
	let keyboardProxy: HTMLInputElement;
	let shortcutsDialog: HTMLDialogElement;
	let accountMenu = $state<{ open: (trigger: HTMLButtonElement) => void }>();
	let searchReturn: { url: URL; restoreFocus: () => void } | undefined;
	let cancelFocusRestore: (() => void) | undefined;
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
	let identity = $state.raw<{ did: string; avatar?: string; name?: string }>();
	const did = $derived(account.did);
	$effect(() => {
		if (!did) return;
		const owner = did;
		const controller = new AbortController();
		void accountIdentity(owner, controller.signal).catch(() => undefined).then(found => {
			if (!controller.signal.aborted) identity = found ? { did: owner, ...found } : undefined;
		});
		return () => controller.abort();
	});
	let uploading = $derived(activeUploadCount(account.did));
	const links = [
		{ path: '/', label: 'home', icon: 'ph_home', filled: 'ph_home_f' },
		{ path: '/search', label: 'search', icon: 'ph_search', filled: 'ph_search_f' },
		{ path: '/library', label: 'library', icon: 'ph_library', filled: 'ph_library_f' }
	] as const;
	const explore = [
		{ path: '/radio', label: 'radio', icon: 'ph_radio', filled: 'ph_radio_f' },
		{ path: '/atlas', label: 'atlas', icon: 'ph_atlas', filled: 'ph_atlas_f' },
		{ path: '/stats', label: 'stats', icon: 'ph_stats', filled: 'ph_stats_f' }
	] as const;
	const accountPaths = [resolve('/(app)/settings'), resolve('/(app)/portal'), resolve('/(app)/get-paid')] as string[];
	let searchKey = $state('Ctrl K');
	let sidebarKey = $state('Ctrl B');
	let collapsed = $state(navCollapsed());
	// while the width animates, the open layout stays put inside a clipped rail and its words fade,
	// so nothing snaps into the narrow layout (or out of it) halfway through the slide
	let sliding = $state(false);
	let slideEnd: ReturnType<typeof setTimeout> | undefined;
	function toggleSidebar() {
		if (matchMedia('(max-width: 720px)').matches) return;
		const next = !collapsed;
		clearTimeout(slideEnd);
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
			sliding = false;
			collapsed = next;
			setNavCollapsed(next);
			return;
		}
		sliding = true;
		setNavCollapsed(next);
		if (!next) collapsed = false;
		slideEnd = setTimeout(() => { collapsed = next; sliding = false; }, 200);
	}
	function openShortcuts() { shortcutsDialog.showModal(); }
	const keyboardGuide = [
		{ action: 'search', keys: ['⌘ or Ctrl', 'K'] },
		{ action: 'jump to search', keys: ['/'] },
		{ action: 'settings', keys: ['⌘ or Ctrl', ','] },
		{ action: 'show or hide the sidebar', keys: ['⌘ or Ctrl', 'B'] },
		{ action: 'queue', keys: ['Q'] },
		{ action: 'play or pause', keys: ['Space'] },
		{ action: 'seek back or forward 10 seconds', keys: ['←', '→'] },
		{ action: 'previous track or restart', keys: ['J'] },
		{ action: 'next track', keys: ['L'] },
		{ action: 'mute or unmute', keys: ['M'] }
	];

	beforeNavigate(() => cancelFocusRestore?.());
	let arrivedInApp = false;
	afterNavigate(({ from, to }) => {
		arrivedInApp = !!from;
		if (from && dialog?.open) nowPlayingView?.dismiss();
		if (to?.url.pathname !== resolve('/search')) {
			if (searchReturn && searchReturn.url.href === to?.url.href) searchReturn.restoreFocus();
			searchReturn = undefined;
		}
	});

	onMount(() => {
		if (/Mac|iPhone|iPad/.test(navigator.platform)) { searchKey = '⌘K'; sidebarKey = '⌘B'; }
		// until auth settles, keep the prefs app.html painted with: applying the signed-out
		// ones while the session restores flashed a signed-in dark theme to light on reload
		if (account.ready) restorePrefs(account.did, account.agent, account.accountSync);
		const stopPrefs = mountPrefs();
		let resumed = account.rpc;
		const unsubscribe = auth.subscribe(() => {
			const next = auth.getAuth();
			if (next.ready && (!account.ready || account.did !== next.did || account.agent !== next.agent || account.accountSync !== next.accountSync)) {
				restorePrefs(next.did, next.agent, next.accountSync);
			}
			account = next;
			if (resumed === account.rpc) return;
			resumed = account.rpc;
			const owner = account.did;
			const rpc = account.rpc;
			// is everything of yours on your PDS? asked once per sign-in, off the critical path
			if (owner) void pdsAudio.check();
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

	async function toggleSearch(close = true) {
		if (page.url.pathname === resolve('/search')) {
			if (close && page.state.shortcutSearch) {
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

	// iOS Safari opens the keyboard only for a focus() inside the tap, and the search field
	// mounts after navigation. Focus a stand-in now; the field's autofocus takes it over.
	function holdKeyboard(event: MouseEvent) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		keyboardProxy.focus({ preventScroll: true });
	}

	function toggleQueue() {
		if (queuePage) {
			player.queueOpen = false;
			if (page.state.toggledQueue || arrivedInApp) history.back();
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
			else if (key === 'b' && !(event.target instanceof HTMLElement && event.target.isContentEditable)) { event.preventDefault(); toggleSidebar(); }
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
		if (key === '?') { event.preventDefault(); openShortcuts(); return; }
		if (key === 'q') { event.preventDefault(); toggleQueue(); return; }
		if (key === '/') { event.preventDefault(); void toggleSearch(false); return; }
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
<input bind:this={keyboardProxy} class="keyboard-proxy" type="search" tabindex="-1" aria-hidden="true" autocomplete="off" />

<div data-testid="app-frame" class="frame" class:hasPlayer={!!player.current} class:docked={queuePanelOpen} class:collapsed class:sliding>
	<nav aria-label="Main navigation">
		<div class="brand-row">
			<LinksMenu onShortcuts={openShortcuts} /><a class="brand" aria-label="plyr.fm home" href="/">plyr.fm</a>
			<button type="button" class="sidebar-toggle" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onclick={toggleSidebar}>
				<Icon name="sidebar" size={20} stroke={1.6} /><span class="label">{collapsed ? 'expand' : 'collapse'} <kbd>{sidebarKey}</kbd></span>
			</button>
		</div>
		<a class="search-field desktop-only" href="/search" onclick={holdKeyboard} class:active={page.url.pathname === '/search'} aria-current={page.url.pathname === '/search' ? 'page' : undefined}>
			<Icon name="ph_search" size={18} /><span class="label">search</span><kbd aria-hidden="true">{searchKey}</kbd>
		</a>
		{#each links as link (link.path)}
			{@const active = page.url.pathname === link.path}
			<a href={link.path} onclick={link.path === '/search' ? holdKeyboard : undefined} class:phone-only={link.path === '/search'} class:active aria-current={active ? 'page' : undefined}>
				<Icon name={active ? link.filled : link.icon} size={22} /> <span class="label">{link.label}</span>
			</a>
		{/each}
		{#if account.did}
			<a href="/upload" class:active={page.url.pathname === '/upload'} aria-current={page.url.pathname === '/upload' ? 'page' : undefined}>
				<Icon name={page.url.pathname === '/upload' ? 'ph_upload_f' : 'ph_upload'} size={22} /><span class="label">{uploading ? `uploading ${uploading}` : 'upload'}</span>
			</a>
		{/if}
		<p class="group-label desktop-only" aria-hidden="true">explore</p>
		{#each explore as link (link.path)}
			{@const active = page.url.pathname === link.path}
			<a class="desktop-only" href={link.path} class:active aria-current={active ? 'page' : undefined}>
				<Icon name={active ? link.filled : link.icon} size={22} /><span class="label">{link.label}</span>
			</a>
		{/each}
		<div class="nav-spacer" aria-hidden="true"></div>
		{#if account.did}
			<button type="button" class="account" aria-haspopup="dialog" class:active={accountPaths.includes(page.url.pathname)} aria-current={accountPaths.includes(page.url.pathname) ? 'page' : undefined} onclick={event => accountMenu?.open(event.currentTarget)}>
				<span class="profile-avatar"><Artwork src={identity?.did === did ? identity?.avatar : undefined} size={24} fallbackIcon="user" eager /></span>
				<span class="tab-label label">you</span>
				<span class="who"><strong>{(identity?.did === did && identity?.name) || (account.handle ? '@' + account.handle : 'your account')}</strong>{#if account.handle && identity?.did === did && identity?.name}<small>@{account.handle}</small>{/if}</span>
				<span class="who-chevron" aria-hidden="true"><Icon name="ph_updown" size={16} /></span>
			</button>
		{:else}
			<a class="sign-in" href={resolve('/(app)/login') + '?' + new URLSearchParams({ return_to: page.url.pathname + page.url.search })} class:active={page.url.pathname === '/login'}><Icon name="ph_user" size={22} /><span class="label">sign in</span></a>
		{/if}
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
	<AccountMenu bind:this={accountMenu} identity={account.handle ? '@' + account.handle : account.did} uploads={uploading} onShortcuts={openShortcuts} />
	<PdsAudioSheet />
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
	.keyboard-proxy { position: fixed; top: 0; left: 0; width: 1px; height: 1px; padding: 0; border: 0; opacity: 0; font-size: 16px; pointer-events: none; }
	/* --chrome-bottom is the fixed chrome below the page (player dock, phone tabs); a page that fills the viewport sizes itself to 100dvh minus it. */
	.frame { --chrome-bottom: 0px; min-height: 100dvh; display: grid; grid-template-columns: var(--sidebar) minmax(0, 1fr); padding-bottom: var(--chrome-bottom); }
	.frame.hasPlayer { --chrome-bottom: var(--dock); }
	:global(body:has(.frame.hasPlayer)) { --toast-dock: var(--dock); }
	.frame.docked { grid-template-columns: var(--sidebar) minmax(0, 1fr) var(--queue); }
	nav { position: sticky; top: 0; align-self: start; min-height: 100dvh; display: flex; flex-direction: column; gap: 0.125rem; padding: 0.9rem; background: var(--bg); border-right: 1px solid color-mix(in srgb, var(--line) 70%, transparent); }
	nav :is(a, button) { display: flex; align-items: center; gap: 0.75rem; min-height: 2.5rem; padding: 0 0.75rem; border: 0; border-radius: 0.75rem; background: none; color: var(--muted); text-align: start; }
	nav :is(a, button):hover { text-decoration: none; background: var(--raised); }
	nav :is(a, button).active { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); font-weight: 700; }
	nav :global(svg) { flex: none; }
	.brand-row { display: flex; align-items: center; min-height: 3.5rem; gap: 0.1rem; margin-bottom: 0.25rem; }
	nav .brand { padding: 0; min-height: 0; font-weight: 900; font-size: 1.7rem; letter-spacing: -1px; color: var(--text); }
	nav .brand:hover { background: none; }
	.profile-avatar { width: 1.375rem; flex: none; border-radius: 50%; overflow: hidden; }
	.profile-avatar :global(svg) { width: 1.375rem; height: 1.375rem; }
	.group-label { padding: 1.1rem 0.75rem 0.35rem; color: var(--faint); font: 600 var(--t-12-8)/1 system-ui, sans-serif; }
	.who, .who-chevron { display: none; }
	main { min-width: 0; }
	aside { position: sticky; top: 0; align-self: start; min-width: 0; height: calc(100dvh - var(--dock)); overflow-y: auto; border-left: 1px solid var(--line); background: var(--surface); }
	dialog { width: min(36rem, calc(100% - 2rem)); max-height: calc(100dvh - 2rem); color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 1.2rem; padding: 0; }
	dialog::backdrop { background: rgb(0 0 0 / 0.65); }
	dialog.now-sheet { width: 100%; max-width: 100%; height: 100dvh; max-height: 100dvh; margin: 0; border: 0; border-radius: 0; }
	@media (min-width: 721px) {
		nav { height: calc(100dvh - var(--nav-dock, 0px)); min-height: 0; overflow-y: auto; padding: 0.875rem; }
		.frame.hasPlayer { --nav-dock: var(--dock); }
		nav :is(a, button) { font-size: var(--t-15-5); font-weight: 500; }
		nav .phone-only { display: none; }
		nav .search-field { gap: 0.625rem; margin: 0 0 0.75rem; height: 2.5rem; padding: 0 0.625rem 0 0.75rem; background: var(--raised); border: 1px solid color-mix(in srgb, var(--line) 80%, transparent); color: var(--muted); font-size: var(--t-14); }
		nav .search-field kbd { margin-left: auto; padding: 0.2rem 0.375rem; border: 1px solid var(--line); border-radius: 0.375rem; color: var(--muted); font: 500 var(--t-11-2)/1 system-ui, sans-serif; }
		nav .search-field:hover { background: var(--hover); }
		nav .search-field.active { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); font-weight: 500; }
		.nav-spacer { flex: 1; min-height: 1.5rem; }
		nav .account { gap: 0.625rem; min-height: 3.25rem; padding: 0.5rem 0.625rem; border: 1px solid color-mix(in srgb, var(--line) 80%, transparent); border-radius: 0.875rem; background: var(--surface); }
		nav .account.active { background: var(--raised); }
		nav .account .profile-avatar, nav .account .profile-avatar :global(svg) { width: 2.125rem; height: 2.125rem; }
		nav .account .tab-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
		.who { display: grid; min-width: 0; flex: 1; line-height: 1.2; }
		.who strong { color: var(--text); font-size: var(--t-14); font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.who small { color: var(--faint); font: var(--t-12) system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.who-chevron { display: flex; color: var(--faint); }
		nav :is(a, button) { white-space: nowrap; }
		.sidebar-toggle { margin-left: auto; width: 2.25rem; justify-content: center; padding: 0; color: var(--faint); }
		.sidebar-toggle .label, .collapsed nav .label { position: absolute; left: calc(100% + 0.5rem); top: 50%; z-index: 1; padding: 0.3rem 0.55rem; border: 1px solid var(--line); border-radius: 0.5rem;
			background: var(--surface); color: var(--text); box-shadow: 0 0.25rem 0.9rem rgb(0 0 0 / 0.16); font: 500 var(--t-13-6)/1.2 system-ui, sans-serif;
			transform: translateY(-50%); opacity: 0; pointer-events: none; transition: opacity 0.12s; }
		.frame:not(.collapsed) .sidebar-toggle .label { top: calc(100% + 0.35rem); left: auto; right: 0; transform: none; }
		.sidebar-toggle .label kbd { margin-left: 0.25rem; color: var(--faint); font: inherit; }
		nav :is(a, button):is(:hover, :focus-visible) > .label { opacity: 1; transition-delay: 0.35s; }
		nav .sidebar-toggle { position: relative; }
		/* sliding: words fade while the rail's width animates; the rail clips whatever is still wider than it */
		nav :is(.brand, .search-field > .label, .search-field kbd, a > .label, .account .who, .who-chevron, .group-label, .brand-row :global(.trigger)) { transition: opacity 0.14s ease-out; }
		.sliding nav { overflow: hidden; }
		.sliding nav :is(.brand, .search-field > .label, .search-field kbd, a > .label, .account .who, .who-chevron, .group-label, .brand-row :global(.trigger)) { opacity: 0; transition-duration: 0.1s; }
		.sliding nav .sidebar-toggle .label { display: none; }
		/* the open sidebar names its toggle only on hover; collapsed, every item does */
		.collapsed nav { overflow: visible; z-index: 7; }
		.collapsed nav :is(a, button) { position: relative; }
		.collapsed .brand-row :global(.trigger), .collapsed nav .brand, .collapsed nav .search-field kbd, .collapsed .who, .collapsed .who-chevron { display: none; }
		.collapsed .sidebar-toggle { margin-left: 0; width: 100%; height: 2.5rem; }
		.collapsed nav .search-field { justify-content: center; padding: 0; background: none; border-color: transparent; }
		.collapsed nav .search-field:hover { background: var(--raised); }
		/* collapsed, the account is just the avatar circle */
		.collapsed nav .account, .collapsed nav .account:hover { justify-content: center; min-height: 2.75rem; padding: 0; border: 0; background: none; }
		.collapsed nav .account:hover .profile-avatar { filter: brightness(1.08); }
		.collapsed nav .account .tab-label { width: auto; height: auto; overflow: visible; clip-path: none; }
		.collapsed .group-label { height: 1px; margin: 0.9rem 0.6rem; padding: 0; overflow: hidden; color: transparent; background: var(--line); }
	}
	.shortcuts { width: min(30rem, calc(100% - 2rem)); height: fit-content; max-height: calc(100dvh - 2rem); margin: auto; padding: 1rem 1.25rem; border: 1px solid var(--line); border-radius: 1rem; background: var(--surface); }
	.shortcuts header, .shortcuts dl div { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
	.shortcuts h2 { font-size: 1.2rem; }
	.shortcuts dl { margin: 0.45rem 0; }
	.shortcuts dl div { border-top: 1px solid var(--line); padding: 0.45rem 0; }
	.shortcuts dd { margin: 0; display: flex; gap: 0.25rem; flex-shrink: 0; }
	.shortcuts kbd { background: var(--raised); border: 1px solid var(--line); border-radius: 0.35rem; padding: 0.15rem 0.4rem; text-align: center; min-width: 1.65rem; font-size: var(--t-12-8); }
	@media (min-width: 721px) and (max-width: 1199px) {
		.frame.docked { grid-template-columns: var(--sidebar) minmax(0, 1fr); }
		aside { position: fixed; z-index: 8; right: 0; bottom: var(--dock); top: auto; height: auto; max-height: calc(100dvh - var(--dock)); width: min(var(--queue), calc(100vw - var(--sidebar))); box-shadow: 0 0 2rem rgb(0 0 0 / 0.15); }
	}
	@media (max-width: 720px) {
		.frame, .frame.docked { display: block; --chrome-bottom: var(--tabs); }
		.frame.hasPlayer { --chrome-bottom: calc(var(--tabs) + var(--dock)); }
		.brand-row, .nav-spacer, aside, nav .desktop-only { display: none; }
		nav { z-index: 9; position: fixed; inset: auto 0.75rem var(--tab-gap); min-height: 0; height: 4rem; flex-direction: row; align-items: center; gap: 0; padding: 0 0.375rem; border: 1px solid color-mix(in srgb, var(--line) 80%, transparent); border-radius: 2rem; background: color-mix(in srgb, var(--surface) 72%, transparent); -webkit-backdrop-filter: blur(22px) saturate(1.7); backdrop-filter: blur(22px) saturate(1.7); box-shadow: 0 0.625rem 1.875rem rgb(0 0 0 / 0.18); }
		nav :is(a, button) { flex: 1; min-width: 0; flex-direction: column; justify-content: center; gap: 0.125rem; height: 3.375rem; min-height: 0; padding: 0.125rem; border-radius: 1.6875rem; font: 600 var(--t-10-5)/1.2 system-ui, sans-serif; -webkit-tap-highlight-color: transparent; }
		nav :is(a, button) :global(svg) { width: 1.5rem; height: 1.5rem; }
		nav :is(a, button) span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		nav :is(a, button):hover { background: none; }
		nav :is(a, button).active, nav :is(a, button).active:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); font-weight: 700; }
		nav :is(a, button):focus-visible { outline-offset: -3px; }
		nav .account .profile-avatar, nav .account .profile-avatar :global(svg) { width: 1.5rem; height: 1.5rem; }
		dialog:not(.shortcuts) { width: 100%; max-width: 100%; height: 100dvh; max-height: 100dvh; margin: 0; border: 0; border-radius: 0; }
		dialog.now-sheet { background: transparent; overscroll-behavior: contain; }
		.now-sheet::backdrop { background: rgb(0 0 0 / var(--player-backdrop, 0.18)); }
	}
</style>
