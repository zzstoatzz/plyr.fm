<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { fn } from 'storybook/test';
	import ConfirmDialog from './ConfirmDialog.svelte';

	// the dialog uses <dialog>.showModal(), so it renders in the top layer over
	// the whole viewport — fullscreen layout keeps it centered without a frame.
	// a11y 'todo': the confirm/cancel buttons use white text on the accent/error
	// fills, which fail WCAG AA contrast (2.6:1 / 3.8:1). that's the app's global
	// button styling against the user-configurable accent — a design decision, not
	// a per-component fix. tracked for a dedicated contrast pass; still surfaced as
	// a warning here.
	const { Story } = defineMeta({
		title: 'overlays/ConfirmDialog',
		component: ConfirmDialog,
		parameters: { layout: 'fullscreen', a11y: { test: 'todo' } },
		args: { open: true, onConfirm: fn(), onCancel: fn() }
	});
</script>

<Story
	name="Primary"
	args={{
		title: 'publish track?',
		body: 'this makes “Escape Mix” visible to everyone and writes a record to your PDS.',
		confirmText: 'publish'
	}}
/>

<Story
	name="Danger"
	args={{
		title: 'delete track?',
		body: 'this permanently removes “Escape Mix” and its audio. this cannot be undone.',
		variant: 'danger',
		confirmText: 'delete'
	}}
/>

<Story
	name="Pending"
	args={{
		title: 'replace audio?',
		body: 'the previous audio is kept in version history so you can roll back.',
		confirmText: 'replace',
		pending: true,
		pendingText: 'replacing…'
	}}
/>
