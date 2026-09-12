<script lang="ts">
	import PublishingControls from './PublishingControls.svelte';
	import { publishingSummary, type PublishingDefaults } from '$lib/publishing';

	interface Props {
		value: PublishingDefaults | null;
		defaults: PublishingDefaults;
		source?: string;
		scope?: string;
		showSpace?: boolean;
		showRights?: boolean;
		valueLabel?: string;
	}
	let {
		value = $bindable(),
		defaults,
		source = 'Portal',
		scope = 'track',
		showSpace = false,
		showRights = false,
		valueLabel
	}: Props = $props();
	const effective = $derived(value ?? defaults);
</script>

<section class="publishing-settings">
	<p>{publishingSummary(effective)}</p>
	<small
		>{value
			? (valueLabel ?? `custom settings for this ${scope}`)
			: `using ${source} defaults`}</small
	>
	<details>
		<summary>change for this {scope}</summary>
		<div class="expanded">
			<PublishingControls
				bind:value={() => value ?? defaults, (next) => (value = next)}
				{showSpace}
				{showRights}
			/>
			{#if value}<button type="button" onclick={() => (value = null)}>use {source} defaults</button
				>{/if}
		</div>
	</details>
</section>

<style>
	.publishing-settings {
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		padding: 1rem;
	}
	p {
		margin: 0 0 0.35rem;
		line-height: 1.5;
	}
	small {
		color: var(--text-tertiary);
	}
	summary {
		cursor: pointer;
		color: var(--accent);
		padding-top: 0.75rem;
		font-size: var(--text-sm);
	}
	.expanded {
		padding-top: 1rem;
		display: grid;
		gap: 1rem;
	}
	button {
		justify-self: start;
		background: none;
		border: 0;
		color: var(--accent);
		font: inherit;
		cursor: pointer;
		padding: 0;
	}
</style>
