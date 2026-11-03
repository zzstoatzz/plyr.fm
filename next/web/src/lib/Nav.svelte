<script lang="ts">
	// phones: bottom tab bar. ≥ 800px: left rail (social-app's shell).
	import { page } from '$app/state';
	import { auth } from './auth.svelte';
	import Icon, { type IconName } from './ui/Icon.svelte';

	const tabs = $derived<{ href: string; label: string; icon: IconName; active: boolean }[]>([
		{ href: '/', label: 'home', icon: 'home', active: page.url.pathname === '/' },
		{ href: '/search', label: 'search', icon: 'search', active: page.url.pathname.startsWith('/search') },
		{ href: '/library', label: 'library', icon: 'library', active: page.url.pathname.startsWith('/library') },
		auth.did
			? { href: '/portal', label: 'portal', icon: 'portal', active: page.url.pathname.startsWith('/portal') }
			: { href: '/login', label: 'sign in', icon: 'user', active: page.url.pathname.startsWith('/login') }
	]);
	const rail = $derived([
		...tabs,
		...(auth.did
			? [{ href: '/upload', label: 'upload', icon: 'upload' as IconName, active: page.url.pathname.startsWith('/upload') }]
			: []),
		{ href: '/settings', label: 'settings', icon: 'settings' as IconName, active: page.url.pathname.startsWith('/settings') }
	]);
</script>

<nav class="rail" aria-label="main">
	<a class="brand plain" href="/">plyr.fm <span class="tag">next</span></a>
	{#each rail as t (t.href)}
		<a class="item plain" class:active={t.active} href={t.href} aria-current={t.active ? 'page' : undefined}>
			<Icon name={t.icon} size={24} stroke={t.active ? 2.5 : 2} />
			<span>{t.label}</span>
		</a>
	{/each}
	{#if auth.did}
		<a class="me plain" href="/u/{auth.handle ?? auth.did}">
			{#if auth.avatar}<img src={auth.avatar} alt="" width="32" height="32" />{:else}<span class="ph"></span>{/if}
			<span class="ellipsis">
				<strong class="ellipsis">{auth.displayName ?? auth.handle}</strong>
				{#if auth.handle}<span class="muted small ellipsis">@{auth.handle}</span>{/if}
			</span>
		</a>
	{/if}
</nav>

<nav class="tabbar glass" aria-label="tabs">
	{#each tabs as t (t.href)}
		<a class="tab plain" class:active={t.active} href={t.href} aria-current={t.active ? 'page' : undefined}>
			{#if t.href === '/portal' && auth.avatar}
				<img class="tab-avatar" class:active={t.active} src={auth.avatar} alt="" width="26" height="26" />
			{:else}
				<Icon name={t.icon} size={26} stroke={t.active ? 2.6 : 1.9} />
			{/if}
			<span class="sr-only">{t.label}</span>
		</a>
	{/each}
</nav>

<style>
	.rail {
		display: none;
	}
	.tabbar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 20;
		display: flex;
		height: calc(var(--tabbar) + env(safe-area-inset-bottom));
		padding-bottom: env(safe-area-inset-bottom);
		box-shadow: inset 0 1px 0 var(--glass-edge);
	}
	/* docked under the mini player: one surface, no seam */
	:global(.has-player) .tabbar {
		box-shadow: none;
	}
	.tab {
		flex: 1;
		display: grid;
		place-items: center;
		color: var(--c-600);
	}
	.tab.active {
		color: var(--c-1000);
	}
	.tab-avatar {
		width: 1.625rem;
		height: 1.625rem;
		border-radius: 50%;
		object-fit: cover;
		box-shadow: 0 0 0 1px var(--c-100);
	}
	.tab-avatar.active {
		box-shadow: 0 0 0 2px var(--c-1000);
	}
	@media (min-width: 800px) {
		.tabbar {
			display: none;
		}
		.rail {
			position: sticky;
			top: 0;
			display: flex;
			flex-direction: column;
			gap: var(--s-2xs);
			width: var(--rail);
			height: 100dvh;
			padding: var(--s-lg) var(--s-md) calc(var(--s-lg) + 4.5rem);
		}
		.brand {
			padding: var(--s-sm) var(--s-md) var(--s-lg);
			font-size: var(--t-xl);
			font-weight: 800;
			letter-spacing: -0.01em;
		}
		.tag {
			font-size: var(--t-xs);
			font-weight: 700;
			color: var(--accent-text);
			vertical-align: super;
		}
		.item {
			display: flex;
			align-items: center;
			gap: var(--s-md);
			padding: var(--s-sm) var(--s-md);
			border-radius: var(--r-full);
			font-size: var(--t-lg);
			color: var(--c-800);
		}
	@media (hover: hover) {
		.item:hover {
				background: var(--c-25);
			}
			.item.active {
				font-weight: 700;
				color: var(--c-1000);
			}
			.me {
				margin-top: auto;
				display: flex;
				align-items: center;
				gap: var(--s-sm);
				padding: var(--s-sm);
				border-radius: var(--r-md);
				min-width: 0;
			}
			.me:hover {
				background: var(--c-25);
			}
			.me > span {
				display: flex;
				flex-direction: column;
				min-width: 0;
			}
			.me img,
			.ph {
				width: 2rem;
				height: 2rem;
				border-radius: 50%;
				object-fit: cover;
				background: var(--c-50);
				flex-shrink: 0;
			}
		}
	}
</style>
