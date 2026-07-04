<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Toast from './Toast.svelte';
	import { toast, type Toast as ToastItem } from '$lib/toast.svelte';

	// Toast renders from the global toast store rather than props. seed the real
	// singleton directly (no auto-dismiss timer fires when we set the array), and
	// clear it on teardown so stories don't leak into each other.
	function seed(items: ToastItem[]) {
		return () => {
			toast.toasts = items;
			return () => {
				toast.toasts = [];
			};
		};
	}

	const base = { duration: 999999, dismissible: true } as const;

	const { Story } = defineMeta({
		title: 'feedback/Toast',
		component: Toast,
		parameters: { layout: 'fullscreen' }
	});
</script>

<Story
	name="Stack of types"
	beforeEach={seed([
		{ id: '1', type: 'success', message: 'track published', ...base },
		{ id: '2', type: 'error', message: 'upload failed — try again', ...base },
		{ id: '3', type: 'warning', message: 'this track may be copyrighted', ...base },
		{ id: '4', type: 'info', message: 'now playing from your library', ...base }
	])}
/>

<Story
	name="With action"
	beforeEach={seed([
		{
			id: '1',
			type: 'success',
			message: 'added to your library',
			action: { label: 'view', href: '/library' },
			...base
		}
	])}
/>
