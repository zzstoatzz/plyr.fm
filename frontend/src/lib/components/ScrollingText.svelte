<script lang="ts">
	// one-line text that truncates with an ellipsis, reveals the full value as a
	// native tooltip, and marquee-scrolls on hover when it overflows — the same
	// scroll technique the footer player uses (TrackInfo.svelte), factored out so
	// list rows (the queue) can reuse it without every row animating at once.
	interface Props {
		text: string;
		/** 'hover' scrolls only while hovered (calm lists); 'always' scrolls whenever it overflows. */
		trigger?: 'hover' | 'always';
	}

	let { text, trigger = 'hover' }: Props = $props();

	let el = $state<HTMLElement | null>(null);
	let overflows = $state(false);
	let hovered = $state(false);

	function measure() {
		if (typeof window === 'undefined' || !el) return;
		window.requestAnimationFrame(() => {
			if (el) overflows = el.scrollWidth > el.clientWidth;
		});
	}

	// re-measure whenever the text changes (row reused for a new track)
	$effect(() => {
		void text;
		measure();
	});

	let scrolling = $derived(overflows && (trigger === 'always' || hovered));
</script>

<div
	class="scroller"
	class:scrolling
	bind:this={el}
	title={text}
	onpointerenter={() => (hovered = true)}
	onpointerleave={() => (hovered = false)}
>
	<span>{text}</span>
</div>

<style>
	.scroller {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		max-width: 100%;
		/* inherit font + color from the caller so this is purely a text-fit concern */
		color: inherit;
		font: inherit;
	}

	.scroller > span {
		color: inherit;
	}

	.scroller.scrolling {
		text-overflow: clip;
		mask-image: linear-gradient(to right, black 0%, black calc(100% - 16px), transparent 100%);
		-webkit-mask-image: linear-gradient(to right, black 0%, black calc(100% - 16px), transparent 100%);
	}

	.scroller.scrolling > span {
		display: inline-block;
		padding-right: 2rem;
		animation: scroll-text 8s linear infinite;
	}

	@keyframes scroll-text {
		0%,
		15% {
			transform: translateX(0);
		}
		100% {
			transform: translateX(-100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.scroller.scrolling > span {
			animation: none;
		}
	}
</style>
