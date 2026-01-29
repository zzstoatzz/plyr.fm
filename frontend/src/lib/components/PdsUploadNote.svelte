<script lang="ts">
	import { auth } from "$lib/auth.svelte";

	const PDS_AUDIO_FLAG = "pds-audio-uploads";
</script>

{#if auth.user?.enabled_flags?.includes(PDS_AUDIO_FLAG)}
	<p class="pds-note">
		audio blobs can be stored on your pds when enabled in
		<a href="/settings">settings</a>. if the file is too large for your pds,
		we fall back to r2.
	</p>
{/if}

<style>
	.pds-note {
		margin-top: 0.5rem;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.pds-note a {
		color: var(--accent);
		text-decoration: none;
	}

	.pds-note a:hover {
		text-decoration: underline;
	}
</style>
