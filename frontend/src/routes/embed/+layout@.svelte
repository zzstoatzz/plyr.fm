<script lang="ts">
	let { children } = $props();
</script>

<div class="embed-layout">
	{@render children?.()}
</div>

<style>
	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}

	:global(:root) {
		/* backgrounds */
		--bg-primary: #0a0a0a;
		--bg-secondary: #141414;
		--bg-tertiary: #1a1a1a;
		--bg-hover: #1f1f1f;

		/* borders */
		--border-subtle: #282828;
		--border-default: #333333;
		--border-emphasis: #444444;

		/* text */
		--text-primary: #e8e8e8;
		--text-secondary: #b0b0b0;
		--text-tertiary: #808080;
		--text-muted: #666666;

		/* accent */
		--accent: #6a9fff;

		/* radii */
		--radius-full: 9999px;
	}

	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
		height: 100%;
		overflow: hidden;
	}

	.embed-layout {
		height: 100%;
		width: 100%;
	}
</style>
