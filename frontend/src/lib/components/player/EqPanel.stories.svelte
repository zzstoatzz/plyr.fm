<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import EqPanel from './EqPanel.svelte';
	import { eq } from '$lib/eq.svelte';
	import { FLAT_GAINS, PRESETS } from '$lib/eq/bands';

	// the panel reads the global eq store; seed it per story and put it back after
	function seed(enabled: boolean, gains: readonly number[]) {
		return () => {
			eq.enabled = enabled;
			eq.gains = [...gains];
			return () => {
				eq.enabled = false;
				eq.gains = [...FLAT_GAINS];
			};
		};
	}

	const BASS = PRESETS.find((p) => p.id === 'bass')?.gains ?? FLAT_GAINS;

	const { Story } = defineMeta({
		title: 'player/EqPanel',
		component: EqPanel,
		parameters: { layout: 'centered' }
	});
</script>

{#snippet framed()}
	<div
		style="width: 340px; padding: 1rem; background: var(--bg-tertiary); border: 1px solid var(--border-default); border-radius: var(--radius-lg);"
	>
		<EqPanel />
	</div>
{/snippet}

<Story name="Off" beforeEach={seed(false, FLAT_GAINS)}>{@render framed()}</Story>
<Story name="Bass" beforeEach={seed(true, BASS)}>{@render framed()}</Story>
<Story name="Custom" beforeEach={seed(true, [3, 1, -2, -4, 0, 2, 5, 3, -1, 6])}
	>{@render framed()}</Story
>
