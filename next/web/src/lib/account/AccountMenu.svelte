<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { logout } from '$lib/auth';
	import Icon from '$lib/ui/Icon.svelte';

	let { identity, uploads }: { identity: string; uploads: number } = $props();
	let dialog: HTMLDialogElement;
	let startedOutside = false;
	const uploadDetail = $derived(uploads === 0 ? 'add a track or album'
		: uploads === 1 ? '1 upload in progress' : `${uploads} uploads in progress`);
	const entries = $derived([
		{ label: 'portal', detail: identity, icon: 'portal', href: resolve('/(app)/portal') },
		{ label: 'upload', detail: uploadDetail, icon: 'upload', href: resolve('/(app)/upload') },
		{ label: 'private music', detail: 'listen to your private tracks', icon: 'music', href: resolve('/(app)/private') },
		{ label: 'settings', detail: 'queue sync', icon: 'settings', href: resolve('/(app)/settings') }
	] as const);

	afterNavigate(({ from }) => {
		if (from && dialog?.open) dialog.close();
	});

	export function open() { dialog.showModal(); }

	async function signOut() {
		dialog.close();
		void logout();
		await goto(resolve('/'));
	}
</script>

<dialog bind:this={dialog} aria-labelledby="account-menu-title"
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
					{#if entry.icon === 'settings'}<Icon name="chevron" size={17} />{/if}
				</a>
			{/each}
			<button type="button" onclick={signOut}><Icon name="logout" size={22} /><span class="row-label">sign out</span></button>
		</nav>
	</div>
</dialog>

<style>
	dialog { width: min(21.25rem, calc(100% - 2rem)); max-height: calc(100dvh - 2rem); margin: auto; padding: 0; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 1rem; box-shadow: 0 0.5rem 2rem rgb(0 0 0 / 0.26); }
	dialog::backdrop { background: rgb(0 0 0 / 0.52); }
	header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.6rem 0.75rem 0.6rem 1.2rem; border-bottom: 1px solid var(--line); }
	h2 { font-size: 0.875rem; font-weight: 650; text-transform: uppercase; letter-spacing: 0.065em; }
	nav { display: grid; padding: 0.45rem; }
	nav :is(a, button) { display: flex; align-items: center; gap: 0.9rem; padding: 0.75rem 0.9rem; min-height: 3.5rem; color: var(--muted); background: none; border: 0; border-radius: 0.65rem; text-align: start; }
	nav :is(a, button):hover { background: var(--hover); text-decoration: none; }
	nav :is(a, button):focus-visible { outline-offset: -2px; }
	.row-label { display: grid; flex: 1; min-width: 0; color: var(--text); overflow-wrap: anywhere; }
	strong { font-weight: 620; }
	small { color: var(--muted); }
</style>
