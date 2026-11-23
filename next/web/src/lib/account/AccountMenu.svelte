<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { auth, logout, otherAccounts, switchAccount } from '$lib/auth';
	import { isModerator } from '$lib/moderation/client';
	import Icon, { type IconName } from '$lib/ui/Icon.svelte';

	let { identity, uploads, onShortcuts }: { identity: string; uploads: number; onShortcuts: () => void } = $props();
	let dialog: HTMLDialogElement;
	let startedOutside = false;
	let others = $state.raw<ReturnType<typeof otherAccounts>>([]);
	let switching = $state(false);
	let error = $state(false);
	let moderator = $state(isModerator(auth.getAuth().did));
	const uploadDetail = $derived(uploads === 0 ? 'add a track or album'
		: uploads === 1 ? '1 upload in progress' : `${uploads} uploads in progress`);
	type Entry = { label: string; detail: string; icon: IconName; href: string };
	const entries: Entry[] = $derived([
		{ label: 'portal', detail: identity, icon: 'ph_portal' as const, href: resolve('/(app)/portal') },
		{ label: 'upload', detail: uploadDetail, icon: 'ph_upload' as const, href: resolve('/(app)/upload') },
		{ label: 'settings', detail: 'appearance and playback', icon: 'ph_settings' as const, href: resolve('/(app)/settings') },
		...(moderator ? [{ label: 'moderation', detail: 'reports waiting for a decision', icon: 'ph_flag' as const, href: resolve('/(app)/moderation') }] : [])
	]);

	afterNavigate(({ from }) => {
		if (from && dialog?.open) dialog.close();
	});

	export function open(trigger: HTMLButtonElement) {
		moderator = isModerator(auth.getAuth().did);
		others = otherAccounts();
		error = false;
		trigger.focus({ preventScroll: true });
		dialog.showModal();
	}

	async function selectAccount(did: ReturnType<typeof otherAccounts>[number]['did']) {
		switching = true;
		error = false;
		try { await switchAccount(did); dialog.close(); }
		catch { error = true; }
		finally { switching = false; }
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
			{#each others as account (account.did)}
				<button type="button" disabled={switching} onclick={() => selectAccount(account.did)}><Icon name="user" size={22} /><span class="row-label">switch to {account.handle ? '@' + account.handle : account.did}</span></button>
			{/each}
			{#if !switching}<a href={resolve('/login?addAccount=1&return_to=%2Fsettings')} onclick={() => dialog.close()}><Icon name="users" size={22} /><span class="row-label">add account</span></a>{/if}
			{#if error}<p class="switch-error" role="alert">couldn’t switch accounts. sign in again to reconnect.</p>{/if}
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
	.switch-error { color: var(--muted); padding-inline: 0.9rem; }
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
		nav :is(a, button):last-child { margin-top: 0.25rem; box-shadow: 0 -1px 0 var(--line); border-radius: 0 0 0.55rem 0.55rem; }
	}
</style>
