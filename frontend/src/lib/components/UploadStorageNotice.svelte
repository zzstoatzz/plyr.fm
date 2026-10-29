<script lang="ts">
	interface Props {
		protectedAudio: boolean;
		spacesSupported: boolean;
		accepted: boolean;
		disabled?: boolean;
	}
	let {
		protectedAudio,
		spacesSupported,
		accepted = $bindable(),
		disabled = false
	}: Props = $props();
</script>

{#if protectedAudio}
	<section class="storage-notice" aria-label="audio storage">
		{#if spacesSupported}
			<p>your audio will live in a Space on your PDS. plyr.fm may keep a playback copy.</p>
		{:else}
			<p>your PDS does not support Spaces yet. protected audio can only be stored on plyr.fm.</p>
			<label>
				<input type="checkbox" bind:checked={accepted} required {disabled} />
				<span>store this audio only on plyr.fm, without a copy on my PDS</span>
			</label>
		{/if}
	</section>
{/if}

<style>
	.storage-notice {
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 1rem;
		font-size: var(--text-sm);
		line-height: 1.5;
	}
	p {
		margin: 0;
		color: var(--text-secondary);
	}
	label {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		margin-top: 0.75rem;
		cursor: pointer;
	}
	input {
		flex: 0 0 auto;
		margin: 0.25rem 0 0;
	}
</style>
