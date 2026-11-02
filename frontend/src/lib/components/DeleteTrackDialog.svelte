<script lang="ts">
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { deleteTrack } from '$lib/tracks.svelte';
	import { toast } from '$lib/toast.svelte';

	/**
	 * the one way to delete a track: a styled confirm that stays open with a
	 * pending label while the server removes the PDS record, audio, and artwork
	 * (several network round trips), then reports success or the real error.
	 * used by the portal track list and the edit-track modal.
	 */
	interface Props {
		open: boolean;
		track: { id: number; title: string } | null;
		onDeleted: (trackId: number) => void | Promise<void>;
	}

	let { open = $bindable(), track, onDeleted }: Props = $props();
	let pending = $state(false);

	async function confirmDelete() {
		if (!track || pending) return;
		const { id } = track;
		pending = true;
		try {
			await deleteTrack(id);
			open = false;
			toast.success('track deleted');
			await onDeleted(id);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'failed to delete track');
		} finally {
			pending = false;
		}
	}
</script>

<ConfirmDialog
	bind:open
	title="delete track?"
	body={track
		? `"${track.title}" will be removed from plyr.fm and its record deleted from your PDS. this can't be undone.`
		: ''}
	confirmText="delete track"
	pendingText="deleting…"
	cancelText="keep it"
	variant="danger"
	{pending}
	onConfirm={confirmDelete}
/>
