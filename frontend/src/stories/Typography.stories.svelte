<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const sizes = [
		{ token: '--text-3xl', use: 'page heading' },
		{ token: '--text-2xl', use: 'large heading' },
		{ token: '--text-xl', use: 'heading' },
		{ token: '--text-lg', use: 'body' },
		{ token: '--text-base', use: 'small body' },
		{ token: '--text-sm', use: 'meta / labels' },
		{ token: '--text-xs', use: 'fine print' }
	];

	const { Story } = defineMeta({
		title: 'Foundations/Typography',
		parameters: { layout: 'fullscreen' }
	});
</script>

<Story name="Type scale">
	<div style="padding:1.5rem; background:var(--bg-primary); color:var(--text-primary); min-height:100vh">
		<p style="margin:0 0 1.5rem; color:var(--text-secondary); font-size:var(--text-sm)">
			the house typeface is <strong>georgia</strong>, a serif — editorial, not the usual product sans.
			readers can pick another font in the app; this is the default.
		</p>
		{#each sizes as size}
			<div style="display:flex; align-items:baseline; gap:1rem; padding:0.5rem 0; border-bottom:1px solid var(--border-subtle)">
				<span style="font-size:var({size.token})">the quick brown fox jumps</span>
				<code style="margin-left:auto; font-size:var(--text-xs); color:var(--text-tertiary); white-space:nowrap">{size.token}</code>
				<span style="font-size:var(--text-xs); color:var(--text-secondary); white-space:nowrap; min-width:8rem; text-align:right">{size.use}</span>
			</div>
		{/each}
	</div>
</Story>
