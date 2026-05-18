<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { swipeToDismiss } from '$lib/swipe-to-dismiss';

	interface Props {
		open: boolean;
		onClose: () => void;
		ariaLabel: string;
		/** css max-width override (default: '400px') */
		maxWidth?: string;
		/** css max-height override (default: '60vh') */
		maxHeight?: string;
		/** on desktop (>=600px), switch from bottom sheet to centered modal */
		centerOnDesktop?: boolean;
		children: Snippet;
	}

	let {
		open,
		onClose,
		ariaLabel,
		maxWidth = '400px',
		maxHeight = '60vh',
		centerOnDesktop = false,
		children
	}: Props = $props();

	let sheetEl: HTMLDivElement | null = $state(null);
	let previousFocus: HTMLElement | null = null;

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		} else if (event.key === 'Tab') {
			trapFocus(event);
		}
	}

	function trapFocus(event: KeyboardEvent) {
		if (!sheetEl) return;
		const focusable = sheetEl.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
		);
		if (focusable.length === 0) {
			event.preventDefault();
			sheetEl.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement as HTMLElement | null;

		if (event.shiftKey && active === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first.focus();
		}
	}

	$effect(() => {
		if (open && sheetEl) {
			previousFocus = document.activeElement as HTMLElement | null;
			// defer to next tick so the open transition can begin before focus moves
			tick().then(() => sheetEl?.focus({ preventScroll: true }));
		} else if (!open && previousFocus) {
			previousFocus.focus?.();
			previousFocus = null;
		}
	});
</script>

<svelte:window onkeydown={open ? handleKeydown : null} />

<div
	class="sheet-backdrop"
	class:open
	class:center-desktop={centerOnDesktop}
	role="presentation"
	onclick={handleBackdropClick}
	inert={open ? undefined : true}
>
	<div
		bind:this={sheetEl}
		class="sheet"
		role="dialog"
		aria-modal="true"
		aria-label={ariaLabel}
		tabindex="-1"
		style="--bottom-sheet-max-width: {maxWidth}; --bottom-sheet-max-height: {maxHeight};"
		{@attach swipeToDismiss(onClose)}
	>
		<div class="sheet-handle-area" role="presentation">
			<div class="sheet-handle"></div>
		</div>
		{@render children()}
	</div>
</div>

<style>
	.sheet-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 9999;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.sheet-backdrop.open {
		opacity: 1;
		pointer-events: auto;
	}

	.sheet {
		width: 100%;
		max-width: var(--bottom-sheet-max-width, 400px);
		max-height: var(--bottom-sheet-max-height, 60vh);
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-bottom: none;
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		display: flex;
		flex-direction: column;
		transform: translateY(100%);
		transition: transform 0.2s ease-out;
		padding-bottom: env(safe-area-inset-bottom, 0px);
		/* let the browser scroll vertically by default; the gesture only takes
		   over when our pointer handler explicitly applies a transform */
		touch-action: pan-y;
	}

	.sheet-backdrop.open .sheet {
		transform: translateY(0);
	}

	.sheet-handle-area {
		display: flex;
		justify-content: center;
		align-items: center;
		padding: 0.75rem 1rem 0.5rem;
		flex-shrink: 0;
		-webkit-user-select: none;
		user-select: none;
	}

	.sheet-handle {
		width: 36px;
		height: 4px;
		background: var(--border-default);
		border-radius: 2px;
		flex-shrink: 0;
	}

	@media (min-width: 600px) {
		.sheet-backdrop.center-desktop {
			align-items: center;
		}

		.sheet-backdrop.center-desktop .sheet {
			border-radius: var(--radius-xl);
			border-bottom: 1px solid var(--border-subtle);
			transform: scale(0.95);
			opacity: 0;
			transition:
				transform 0.2s ease-out,
				opacity 0.15s;
		}

		.sheet-backdrop.center-desktop.open .sheet {
			transform: scale(1);
			opacity: 1;
		}

		.sheet-backdrop.center-desktop .sheet-handle-area {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet,
		.sheet-backdrop {
			transition: none;
		}
	}
</style>
