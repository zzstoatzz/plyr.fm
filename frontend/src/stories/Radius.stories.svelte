<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const radii = [
		'--radius-sm',
		'--radius-base',
		'--radius-md',
		'--radius-lg',
		'--radius-xl',
		'--radius-2xl',
		'--radius-full'
	];

	const { Story } = defineMeta({
		title: 'Foundations/Radius',
		parameters: { layout: 'fullscreen' }
	});
</script>

<Story name="Radius scale">
	<div style="padding:1.5rem; background:var(--bg-primary); color:var(--text-primary); min-height:100vh">
		<div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:1rem">
			{#each radii as radius}
				<div style="text-align:center">
					<div style="height:88px; background:var(--bg-secondary); border:1px solid var(--border-emphasis); border-radius:var({radius})"></div>
					<code style="display:block; margin-top:0.5rem; font-size:var(--text-xs); color:var(--text-tertiary)">{radius}</code>
				</div>
			{/each}
		</div>
	</div>
</Story>
