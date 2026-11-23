<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { auth, forgetAccount, logout, otherAccounts, signBackIn, switchAccount, SwitchError, type OtherAccount } from '$lib/auth';
	import { isModerator } from '$lib/moderation/client';
	import { accountIdentity } from '$lib/api';
	import Artwork from '$lib/ui/Artwork.svelte';
	import Icon, { type IconName } from '$lib/ui/Icon.svelte';

	let { handle, name, avatar, uploads, onShortcuts }: { handle: string | null; name?: string; avatar?: string; uploads: number; onShortcuts: () => void } = $props();
	let dialog: HTMLDialogElement;
	let startedOutside = false;
	let others = $state.raw<OtherAccount[]>([]);
	let switching = $state(false);
	let failure = $state.raw<{ did: string; message: string }>();
	let expanded = $state(false);
	let faces = $state.raw<Record<string, { avatar?: string; name?: string }>>({});
	const you = $derived(name || (handle ? '@' + handle : 'your account'));
	let moderator = $state(isModerator(auth.getAuth().did));
	const uploadDetail = $derived(uploads === 0 ? 'add a track or album'
		: uploads === 1 ? '1 upload in progress' : `${uploads} uploads in progress`);
	type Entry = { label: string; detail: string; icon: IconName; href: string };
	const entries: Entry[] = $derived([
		{ label: 'portal', detail: you, icon: 'ph_portal' as const, href: resolve('/(app)/portal') },
		{ label: 'upload', detail: uploadDetail, icon: 'ph_upload' as const, href: resolve('/(app)/upload') },
		{ label: 'settings', detail: 'appearance and playback', icon: 'ph_settings' as const, href: resolve('/(app)/settings') },
		...(moderator ? [{ label: 'moderation', detail: 'reports waiting for a decision', icon: 'ph_flag' as const, href: resolve('/(app)/moderation') }] : [])
	]);

	afterNavigate(({ from }) => {
		if (from && dialog?.open) dialog.close();
	});

	export function open(trigger: HTMLButtonElement) {
		moderator = isModerator(auth.getAuth().did);
		failure = undefined;
		expanded = false;
		void otherAccounts().then(found => { others = found; for (const account of found) void face(account.did); });
		trigger.focus({ preventScroll: true });
		dialog.showModal();
	}

	/** an account's name and picture, fetched once per page load */
	async function face(did: string) {
		if (did in faces) return;
		faces = { ...faces, [did]: {} };
		const found = await accountIdentity(did, new AbortController().signal).catch(() => ({}));
		faces = { ...faces, [did]: found };
	}
	const named = (account: OtherAccount) => faces[account.did]?.name || (account.handle ? '@' + account.handle : 'that account');

	async function selectAccount(account: OtherAccount) {
		switching = true;
		failure = undefined;
		try { await switchAccount(account.did); dialog.close(); }
		catch (error) {
			const reason = error instanceof SwitchError ? error.reason : undefined;
			if (reason === 'signed-out') others = others.map(item => item.did === account.did ? { ...item, signedIn: false } : item);
			failure = { did: account.did, message: reason === 'signed-out'
				? `${named(account)} is signed out on this browser. sign in again, or remove it.`
				: reason === 'unreachable' ? `couldn’t reach ${named(account)}’s account host. try again.`
				: `couldn’t switch to ${named(account)}. try again.` };
		}
		finally { switching = false; }
	}

	async function signIn(account: OtherAccount) {
		switching = true;
		failure = undefined;
		try { await signBackIn(account, page.url.pathname + page.url.search); }
		catch { failure = { did: account.did, message: `couldn’t start signing in to ${named(account)}. try again.` }; switching = false; }
	}

	async function remove(account: OtherAccount) {
		others = others.filter(item => item.did !== account.did);
		if (failure?.did === account.did) failure = undefined;
		await forgetAccount(account.did);
	}

	async function signOut() {
		dialog.close();
		void logout();
		await goto(resolve('/'));
	}
</script>

<dialog bind:this={dialog} aria-labelledby="account-menu-title" class="account-menu"
	onpointerdown={event => { startedOutside = event.target === dialog; }}
	onclick={event => { if (startedOutside && event.target === dialog) dialog.close(); }}>
	<div class="panel">
		<header>
			<h2 id="account-menu-title">account</h2>
			<form method="dialog"><button class="icon-button" aria-label="Close account menu"><Icon name="x" size={19} /></button></form>
		</header>
		<nav aria-label="Account actions">
			{#each entries as entry (entry.label)}
				<a href={entry.href} onclick={() => dialog.close()}>
					<Icon name={entry.icon} size={22} />
					<span class="row-label"><strong>{entry.label}</strong><small>{entry.detail}</small></span>
					{#if entry.icon === 'ph_settings'}<Icon name="chevron" size={17} />{/if}
				</a>
			{/each}
			<button type="button" class="keys" onclick={() => { dialog.close(); onShortcuts(); }}><Icon name="ph_keys" size={22} /><span class="row-label"><strong>keyboard shortcuts</strong><small>press ?</small></span></button>
			{#if others.length}
				<button type="button" class="accounts-toggle" aria-expanded={expanded} aria-controls="account-switcher" onclick={() => { expanded = !expanded; }}>
					<Icon name="users" size={22} />
					<span class="row-label">switch account</span>
					<span class="stack" aria-hidden="true">{#each others.slice(0, 3) as account (account.did)}<span class="face" class:dim={!account.signedIn}><Artwork src={faces[account.did]?.avatar} size={20} fallbackIcon="user" eager /></span>{/each}</span>
					<span class="turn" class:open={expanded}><Icon name="chevron" size={17} /></span>
				</button>
				{#if expanded}
					<div id="account-switcher" class="switcher" role="group" aria-label="Your accounts">
						<div class="account current">
							<span class="avatar"><Artwork src={avatar} size={30} fallbackIcon="user" eager /></span>
							<span class="who"><strong>{you}</strong>{#if handle && name}<small>@{handle}</small>{/if}</span>
							<span class="check" role="img" aria-label="current account"><Icon name="check" size={17} /></span>
						</div>
						{#each others as account (account.did)}
							{#if account.signedIn}
								<button type="button" class="account" disabled={switching} onclick={() => selectAccount(account)}>
									<span class="avatar"><Artwork src={faces[account.did]?.avatar} size={30} fallbackIcon="user" eager /></span>
									<span class="who"><strong>{named(account)}</strong>{#if account.handle && faces[account.did]?.name}<small>@{account.handle}</small>{/if}</span>
								</button>
							{:else}
								<div class="account signed-out">
									<span class="avatar"><Artwork src={faces[account.did]?.avatar} size={30} fallbackIcon="user" eager /></span>
									<span class="who"><strong>{named(account)}</strong><small>signed out · <button type="button" class="sign-in" disabled={switching} onclick={() => signIn(account)}>sign in</button></small></span>
									<button type="button" class="remove" disabled={switching} aria-label="Remove {named(account)} from this list" onclick={() => remove(account)}><Icon name="x" size={16} /></button>
								</div>
							{/if}
							{#if failure?.did === account.did}<p class="switch-error" role="alert">{failure.message}</p>{/if}
						{/each}
						{#if !switching}<a class="account add" href={resolve('/login?addAccount=1&return_to=%2Fsettings')} onclick={() => dialog.close()}><span class="avatar plus"><Icon name="plus" size={18} /></span><span class="who">add account</span></a>{/if}
					</div>
				{/if}
			{:else if !switching}
				<a href={resolve('/login?addAccount=1&return_to=%2Fsettings')} onclick={() => dialog.close()}><Icon name="users" size={22} /><span class="row-label">add account</span></a>
			{/if}
			<button type="button" disabled={switching} onclick={signOut}><Icon name="ph_logout" size={22} /><span class="row-label">sign out</span></button>
		</nav>
	</div>
</dialog>

<style>
	dialog { width: min(21.25rem, calc(100% - 2rem)); max-height: calc(100dvh - 2rem); margin: auto; padding: 0; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 1rem; box-shadow: 0 0.5rem 2rem rgb(0 0 0 / 0.26); }
	dialog::backdrop { background: rgb(0 0 0 / 0.52); }
	header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.6rem 0.75rem 0.6rem 1.2rem; border-bottom: 1px solid var(--line); }
	h2 { font-size: var(--t-14); font-weight: 650; text-transform: uppercase; letter-spacing: 0.065em; }
	nav { display: grid; padding: 0.45rem; }
	nav :is(a, button) { display: flex; align-items: center; gap: 0.9rem; padding: 0.75rem 0.9rem; min-height: 3.5rem; color: var(--muted); background: none; border: 0; border-radius: 0.65rem; text-align: start; }
	nav :is(a, button):hover { background: var(--hover); text-decoration: none; }
	nav :is(a, button):focus-visible { outline-offset: -2px; }
	.row-label { display: grid; flex: 1; min-width: 0; color: var(--text); overflow-wrap: anywhere; }
	strong { font-weight: 620; }
	.switch-error { color: var(--muted); padding: 0 0.9rem 0.4rem; font-size: var(--t-14); }
	.stack { display: flex; flex: none; }
	.face { width: 1.25rem; height: 1.25rem; border-radius: 50%; overflow: hidden; box-shadow: 0 0 0 2px var(--surface); }
	.face + .face { margin-left: -0.375rem; }
	.face.dim, .signed-out .avatar { filter: grayscale(1); opacity: 0.55; }
	.turn { display: flex; transition: transform 0.15s ease-out; }
	.turn.open { transform: rotate(90deg); }
	.switcher { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 1px; margin: 0.15rem 0 0.3rem; padding: 0.25rem; max-height: min(22rem, 50dvh); overflow-y: auto; background: var(--raised); border-radius: 0.75rem; }
	nav .switcher .account { display: flex; align-items: center; gap: 0.75rem; min-height: 3rem; padding: 0.45rem 0.6rem; border-radius: 0.55rem; color: var(--text); background: none; box-shadow: none; margin: 0; text-align: start; }
	.switcher .account:is(a, button):hover { background: var(--hover); }
	.avatar { width: 1.875rem; height: 1.875rem; flex: none; border-radius: 50%; overflow: hidden; }
	.avatar.plus { display: grid; place-items: center; color: var(--muted); border: 1px dashed var(--line); box-sizing: border-box; }
	.who { display: grid; flex: 1; min-width: 0; }
	.who :is(strong, small) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
	nav .switcher .who small { display: block; color: var(--muted); font-size: var(--t-12); }
	.check { display: flex; color: var(--accent); }
	.signed-out strong { color: var(--muted); }
	nav .switcher .sign-in { display: inline; min-height: 0; padding: 0; color: var(--accent); font: inherit; font-weight: 650; }
	nav .switcher .sign-in:hover { background: none; text-decoration: underline; }
	nav .switcher .remove { flex: none; justify-content: center; min-width: 2.25rem; min-height: 2.25rem; padding: 0; color: var(--muted); }
	small { color: var(--muted); }
	@media (max-width: 720px), (hover: none) { .keys { display: none; } }
	@media (min-width: 721px) {
		/* a menu that grows out of the account button: the button's own width and left edge, rising from just above it */
		dialog { width: calc(var(--sidebar) - 1.75rem); margin: auto auto calc(var(--toast-dock, 0px) + 4.6rem) 0.875rem; border-radius: 0.875rem; box-shadow: 0 0.75rem 2rem rgb(0 0 0 / 0.22); }
		:global(:root[data-nav='collapsed']) dialog { width: 13rem; margin: auto auto calc(var(--toast-dock, 0px) + 0.875rem) calc(var(--sidebar) + 0.25rem); }
		dialog::backdrop { background: transparent; }
		header { display: none; }
		nav { padding: 0.3rem; }
		nav :is(a, button) { gap: 0.7rem; min-height: 2.5rem; padding: 0.45rem 0.65rem; border-radius: 0.55rem; font-size: var(--t-14); }
		nav :global(svg) { width: 18px; height: 18px; }
		.row-label small { display: none; }
		.row-label { overflow-wrap: normal; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
		strong { font-weight: 550; }
		nav > :is(a, button):last-child { margin-top: 0.25rem; box-shadow: 0 -1px 0 var(--line); border-radius: 0 0 0.55rem 0.55rem; }
	}
</style>
