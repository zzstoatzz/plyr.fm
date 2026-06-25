<script lang="ts">
	import type { AtClient } from '$lib/atclients';

	let { client, size = 20 }: { client: AtClient; size?: number } = $props();
</script>

<!--
	external client logos ship as transparent marks in arbitrary colors. instead of
	flattening them onto an opaque white tile (looks bad, and breaks at rounded edges),
	we keep them transparent and give each mark a theme-aware halo so it always clears
	the WCAG 1.4.11 non-text contrast bar (3:1) against the surface — a light halo on
	dark, a dark halo on light. handles the hard case (blacksky's black mark on dark).
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
		/* dark theme (default): light halo */
		filter: drop-shadow(0 0 0.5px rgba(255, 255, 255, 0.9))
			drop-shadow(0 0 1.5px rgba(255, 255, 255, 0.55));
	}

	:global(:root.theme-light) .client-logo {
		/* light theme: dark halo */
		filter: drop-shadow(0 0 0.5px rgba(0, 0, 0, 0.75))
			drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.4));
	}
</style>
