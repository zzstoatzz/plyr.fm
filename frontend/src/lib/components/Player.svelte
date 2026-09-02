<script lang="ts">
	import Player from './player/Player.svelte';

	interface Props {
		queueOpen?: boolean;
		onToggleQueue?: () => void;
	}

	let { queueOpen = false, onToggleQueue }: Props = $props();
</script>

<Player {queueOpen} {onToggleQueue} />
