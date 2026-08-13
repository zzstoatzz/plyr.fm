<script lang="ts">
	import { downloadTrack } from '$lib/downloads';

	interface Props {
		fileId: string;
		title?: string;
	}

	let { fileId, title = 'download audio file' }: Props = $props();
</script>

<button class="download-btn" onclick={() => downloadTrack(fileId)} {title}>
	<!-- 15px: the download glyph fills its viewBox denser than share's corner
	     circles do, so equal nominal sizes read unequal. -->
	<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
		<polyline points="7 10 12 15 17 10"></polyline>
		<line x1="12" y1="15" x2="12" y2="3"></line>
	</svg>
</button>

<style>
	.download-btn {
		background: var(--glass-btn-bg, transparent);
		border: 1px solid var(--glass-btn-border, var(--border-default));
		border-radius: var(--radius-base);
		width: 32px;
		height: 32px;
		padding: 0;
		color: var(--text-tertiary);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.download-btn:hover {
		background: var(--glass-btn-bg-hover, transparent);
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
