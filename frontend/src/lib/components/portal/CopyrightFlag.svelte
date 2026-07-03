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
			<span class="copyright-flag-caret" aria-hidden="true"></span>
			<span class="copyright-flag-header">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
					<line x1="12" y1="9" x2="12" y2="13"></line>
					<line x1="12" y1="17" x2="12.01" y2="17"></line>
				</svg>
				<strong class="copyright-flag-heading">possible copyright match</strong>
			</span>
			{#if match}
				<span class="copyright-flag-match">
					<span class="copyright-flag-match-label">matched</span>
					<span class="copyright-flag-match-song">{match}</span>
				</span>
			{/if}
			<span class="copyright-flag-body">
				a match doesn't mean your track is removed — it's flagged for review, and
				false positives happen with samples, covers, and similar progressions.
			</span>
			<span class="copyright-flag-links">
				<a class="copyright-flag-link primary" href={docsUrl} target="_blank" rel="noopener noreferrer">
					how this works →
				</a>
				{#if recordUrl}
					<a class="copyright-flag-link" href={recordUrl} target="_blank" rel="noopener noreferrer">
						view record
					</a>
				{/if}
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
		left: -0.5rem;
		top: calc(100% + 0.5rem);
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: max-content;
		max-width: min(19rem, calc(100vw - 2rem));
		padding: 0.75rem 0.875rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-top: 2px solid var(--warning);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
		white-space: normal;
		text-align: left;
		cursor: default;
	}

	/* little arrow linking the popover back to the ⚠ trigger */
	.copyright-flag-caret {
		position: absolute;
		top: -5px;
		left: 0.9rem;
		width: 8px;
		height: 8px;
		background: var(--bg-secondary);
		border-top: 2px solid var(--warning);
		border-left: 1px solid var(--border-default);
		transform: rotate(45deg);
	}

	.copyright-flag-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--warning);
	}

	.copyright-flag-heading {
		font-size: var(--text-sm);
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	.copyright-flag-match {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.3rem 0.45rem;
		background: color-mix(in srgb, var(--warning) 9%, transparent);
		border-radius: var(--radius-sm);
		font-size: var(--text-sm);
		word-break: break-word;
	}

	.copyright-flag-match-label {
		flex-shrink: 0;
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary);
	}

	.copyright-flag-match-song {
		color: var(--text-primary);
		font-weight: 500;
	}

	.copyright-flag-body {
		font-size: var(--text-xs);
		line-height: 1.5;
		color: var(--text-secondary);
	}

	.copyright-flag-links {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 1rem;
		margin-top: 0.1rem;
		padding-top: 0.55rem;
		border-top: 1px solid var(--border-subtle);
	}

	.copyright-flag-link {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-decoration: none;
	}

	.copyright-flag-link.primary {
		color: var(--accent);
		font-weight: 600;
	}

	.copyright-flag-link:hover {
		text-decoration: underline;
	}
</style>
