<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { player } from '$lib/player.svelte';
	import { connectRadioPresence } from '$lib/radio-presence';

	const connection = $derived({
		station: player.radio?.stationSlug,
		playing: !player.paused,
		account: auth.user?.did
	});
	$effect(() => {
		if (connection.station && connection.playing) return connectRadioPresence(connection.station);
	});
</script>
