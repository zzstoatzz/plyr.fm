<script lang="ts">
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { confirmState } from '$lib/confirm.svelte';

	let request = $derived(confirmState.current);
</script>

<ConfirmDialog
	open={request !== null}
	title={request?.title ?? ''}
	body={request?.body ?? ''}
	confirmText={request?.confirmText}
	cancelText={request?.cancelText}
	variant={request?.variant}
	onConfirm={() => confirmState.settle(true)}
	onCancel={() => confirmState.settle(false)}
/>
