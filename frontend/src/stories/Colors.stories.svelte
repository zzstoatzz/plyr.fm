<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';

	const groups = [
		{ label: 'backgrounds', tokens: ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover'] },
		{ label: 'text', tokens: ['--text-primary', '--text-secondary', '--text-tertiary', '--text-muted'] },
		{ label: 'borders', tokens: ['--border-subtle', '--border-default', '--border-emphasis'] },
		{ label: 'accent', tokens: ['--accent', '--accent-hover', '--accent-muted'] },
		{ label: 'semantic', tokens: ['--success', '--warning', '--error'] }
	];

	const { Story } = defineMeta({
		title: 'Foundations/Colors',
		parameters: { layout: 'fullscreen' }
	});
</script>

<Story name="Palette">
	<div style="padding:1.5rem; background:var(--bg-primary); color:var(--text-primary); min-height:100vh">
		<p style="margin:0 0 1.5rem; color:var(--text-secondary); font-size:var(--text-sm)">
			every color is a token. flip the <strong>theme</strong> toggle in the toolbar to see the light values.
		</p>
		{#each groups as group}
			<section style="margin-bottom:2rem">
				<h3 style="margin:0 0 0.75rem; font-size:var(--text-sm); text-transform:uppercase; letter-spacing:0.06em; color:var(--text-tertiary)">
					{group.label}
				</h3>
				<div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:0.75rem">
					{#each group.tokens as token}
						<div style="border:1px solid var(--border-default); border-radius:var(--radius-md); overflow:hidden">
							<div style="height:64px; background:var({token})"></div>
							<code style="display:block; padding:0.45rem 0.55rem; font-size:var(--text-xs); background:var(--bg-secondary)">{token}</code>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>
</Story>
