<script lang="ts">
	interface Props {
		match?: string | null;
		recordUrl?: string | null;
		docsUrl?: string;
	}

	let {
		match = null,
		recordUrl = null,
		docsUrl = 'https://docs.plyr.fm/artists/#copyright-detection'
	}: Props = $props();

	let open = $state(false);
	let hideTimeout: ReturnType<typeof setTimeout> | null = null;
	let wrapper = $state<HTMLElement | null>(null);

	function clearHide() {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
	}

	function show() {
		clearHide();
		open = true;
	}

	// desktop hover-out: brief grace period so the pointer can travel from the
	// trigger into the popover without it closing underneath them.
	function scheduleHide() {
		clearHide();
		hideTimeout = setTimeout(() => {
			open = false;
			hideTimeout = null;
		}, 150);
	}

	function toggle() {
		open = !open;
	}

	function onWindowPointerDown(event: PointerEvent) {
		const target = event.target;
		if (wrapper && target instanceof Node && !wrapper.contains(target)) open = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') open = false;
	}

	$effect(() => {
		if (!open) return;
		window.addEventListener('pointerdown', onWindowPointerDown);
		window.addEventListener('keydown', onKeydown);
		return () => {
			window.removeEventListener('pointerdown', onWindowPointerDown);
			window.removeEventListener('keydown', onKeydown);
		};
	});
</script>

<span class="copyright-flag-wrapper" bind:this={wrapper}>
	<button
		type="button"
		class="copyright-flag-trigger"
		aria-label="possible copyright match — details"
		aria-expanded={open}
		onclick={toggle}
		onmouseenter={show}
		onmouseleave={scheduleHide}
		onfocus={show}
		onblur={scheduleHide}
	>
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
			<line x1="12" y1="9" x2="12" y2="13"></line>
			<line x1="12" y1="17" x2="12.01" y2="17"></line>
		</svg>
	</button>

	{#if open}
		<span class="copyright-flag-popover" role="tooltip" onmouseenter={show} onmouseleave={scheduleHide}>
			<strong class="copyright-flag-heading">possible copyright match</strong>
			{#if match}
				<span class="copyright-flag-match">matched: {match}</span>
			{/if}
			<span class="copyright-flag-body">
				a match doesn't mean your track is removed — it's flagged for review, and
				false positives happen with samples, covers, and similar progressions.
			</span>
			<span class="copyright-flag-links">
				{#if recordUrl}
					<a href={recordUrl} target="_blank" rel="noopener noreferrer">view record</a>
				{/if}
				<a href={docsUrl} target="_blank" rel="noopener noreferrer">how this works →</a>
			</span>
		</span>
	{/if}
</span>

<style>
	.copyright-flag-wrapper {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
	}

	.copyright-flag-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		/* comfortable tap target around the 16px glyph without disturbing row layout */
		width: 1.75rem;
		height: 1.75rem;
		margin: -0.375rem 0;
		padding: 0;
		background: none;
		border: none;
		color: var(--warning);
		cursor: pointer;
	}

	.copyright-flag-trigger:hover,
	.copyright-flag-trigger[aria-expanded='true'] {
		color: color-mix(in srgb, var(--warning) 80%, white);
	}

	.copyright-flag-popover {
		position: absolute;
		left: 0;
		top: calc(100% + 0.35rem);
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		width: max-content;
		max-width: min(20rem, calc(100vw - 2rem));
		padding: 0.6rem 0.75rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-sm);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		white-space: normal;
		text-align: left;
		cursor: default;
	}

	.copyright-flag-heading {
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--warning);
	}

	.copyright-flag-match {
		font-size: var(--text-sm);
		color: var(--text-primary);
		word-break: break-word;
	}

	.copyright-flag-body {
		font-size: var(--text-xs);
		line-height: 1.4;
		color: var(--text-secondary);
	}

	.copyright-flag-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 0.15rem;
	}

	.copyright-flag-links a {
		font-size: var(--text-xs);
		color: var(--accent);
		text-decoration: none;
	}

	.copyright-flag-links a:hover {
		text-decoration: underline;
	}
</style>
