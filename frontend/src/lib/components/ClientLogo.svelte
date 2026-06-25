<script lang="ts">
	import type { AtClient } from '$lib/atclients';

	let { client, size = 20 }: { client: AtClient; size?: number } = $props();
</script>

<!--
	external client logos ship as transparent marks in arbitrary colors. instead of
	flattening them onto an opaque white tile (looks bad, and breaks at rounded edges),
	we keep them transparent and trace each mark with a thin theme-aware keyline so it
	clears the WCAG 1.4.11 non-text contrast bar (3:1) against the surface — light on
	dark, dark on light. a crisp hard-edge outline (no blur) rather than a soft glow:
	it contours the mark without bleeding into its negative space, so fine marks like
	blacksky's starburst stay legible without looking distorted.
-->
<img
	class="client-logo"
	src={client.iconUrl}
	alt=""
	width={size}
	height={size}
	loading="lazy"
/>

<style>
	.client-logo {
		object-fit: contain;
		/* dark theme (default): thin light keyline */
		filter: drop-shadow(0.5px 0 0 rgba(255, 255, 255, 0.5))
			drop-shadow(-0.5px 0 0 rgba(255, 255, 255, 0.5))
			drop-shadow(0 0.5px 0 rgba(255, 255, 255, 0.5))
			drop-shadow(0 -0.5px 0 rgba(255, 255, 255, 0.5));
	}

	:global(:root.theme-light) .client-logo {
		/* light theme: thin dark keyline */
		filter: drop-shadow(0.5px 0 0 rgba(0, 0, 0, 0.4))
			drop-shadow(-0.5px 0 0 rgba(0, 0, 0, 0.4))
			drop-shadow(0 0.5px 0 rgba(0, 0, 0, 0.4))
			drop-shadow(0 -0.5px 0 rgba(0, 0, 0, 0.4));
	}
</style>
