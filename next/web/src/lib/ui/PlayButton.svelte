<script lang="ts">
	import { showsPause, type PlayContext } from '@plyr/next-core/play-context';
	import { contextState, pressContext } from '$lib/play-control.svelte';
	import Icon from './Icon.svelte';

	let { context, start, name, class: className = 'primary-button', text = false, size, disabled = false }: {
		context: PlayContext; start: () => void;
		/** what plays, for the accessible label: "Pause stellz" */
		name: string;
		class?: string; text?: boolean; size?: number; disabled?: boolean;
	} = $props();
	const playState = $derived(contextState(context));
	const pause = $derived(showsPause(playState));
</script>

<button type="button" class={className} data-play-state={playState} aria-label={`${pause ? 'Pause' : 'Play'} ${name}`} {disabled} onclick={() => pressContext(context, start)}>
	<Icon name={pause ? 'pause' : 'play'} {size} />{#if text}{' '}{pause ? 'Pause' : 'Play'}{/if}
</button>
