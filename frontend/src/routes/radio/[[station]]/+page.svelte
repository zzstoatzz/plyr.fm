<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/stores';
	import Header from '$lib/components/Header.svelte';
	import SisterRadio from '$lib/components/radio/SisterRadio.svelte';
	import { auth } from '$lib/auth.svelte';
	import { radio } from '$lib/radio.svelte';
	import { APP_NAME, APP_CANONICAL_URL } from '$lib/branding';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	$effect(() => {
		const slug = $page.params.station ?? null;
		untrack(() => radio.show(slug));
	});
	onMount(() => {
		if (!radio.stations.length) void radio.loadStations();
	});
	let autoTuned = false;
	$effect(() => {
		if (
			$page.url.searchParams.get('autoplay') === '1' &&
			!autoTuned &&
			radio.hasSomethingOnAir &&
			!radio.active
		) {
			autoTuned = true;
			setTimeout(() => radio.tuneIn(), 0);
		}
	});
	async function handleLogout(): Promise<void> {
		await auth.logout();
		window.location.href = '/';
	}
</script>

<svelte:head>
	<title>{data.station?.name ?? APP_NAME} radio</title>
	<meta
		name="description"
		content={data.station?.description ?? 'listen together to music from plyr.fm'}
	/>
	<meta property="og:title" content={`${data.station?.name ?? APP_NAME} radio`} />
	<meta
		property="og:description"
		content={data.station?.description ?? 'listen together to music from plyr.fm'}
	/>
	<meta property="og:type" content="website" />
	<meta property="og:image" content={`${APP_CANONICAL_URL}/icons/icon-512.png`} />
	<meta
		property="og:url"
		content={`${APP_CANONICAL_URL}/radio/${radio.state?.station_slug ?? 'loved'}`}
	/>
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={handleLogout} />
<main class="radio-shell">
	<SisterRadio />
	<footer>
		<a href="https://tangled.org/zzstoatzz.io/plyr-radio">source</a>
		· a sister radio, forked from
		<a href="https://tangled.org/okami.mom/sister-radio">Ana’s radio</a>
	</footer>
</main>

<style>
	.radio-shell {
		width: min(1360px, calc(100% - 2rem));
		margin: 0 auto;
		padding: 0 0 calc(var(--player-height, 5rem) + 1rem);
	}
	footer {
		text-align: center;
		padding: 1rem;
		color: var(--text-secondary);
		font-size: var(--text-xs);
	}
	footer a {
		color: inherit;
	}
	@media (max-width: 860px) {
		.radio-shell {
			width: 100%;
		}
	}
</style>
