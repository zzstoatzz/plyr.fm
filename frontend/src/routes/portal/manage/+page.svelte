<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import ProfileSection from '$lib/components/portal/ProfileSection.svelte';
	import SharesSection from '$lib/components/portal/SharesSection.svelte';
	import DataSection from '$lib/components/portal/DataSection.svelte';
	import CopyrightSection from '$lib/components/CopyrightSection.svelte';
	import type { Track } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { auth } from '$lib/auth.svelte';
	import { checkAtprotofansEligibility } from '$lib/utils/atprotofans';

	let loading = $state(true);
	let atprotofansEligible = $state(false);
	let checkingAtprotofans = $state(false);

	// own, unfiltered track source — kept independent of the portal's library
	// list (which can be search/sort filtered) so PDS-save candidate detection
	// in DataSection always sees the full set.
	let tracks = $state<Track[]>([]);
	let tracksTotal = $state(0);

	async function loadTracks() {
		try {
			// page through the entire catalog: PDS-save candidate detection in
			// DataSection must see every eligible track, not just the first page.
			const all: Track[] = [];
			let total = 0;
			for (let page = 0; page < 100; page++) {
				const res = await fetch(`${API_URL}/tracks/me?limit=100&offset=${all.length}`, {
					credentials: 'include'
				});
				if (!res.ok) break;
				const data = await res.json();
				all.push(...data.tracks);
				total = data.total;
				if (!data.has_more) break;
			}
			tracks = all;
			tracksTotal = total;
		} catch (_e) {
			console.error('failed to load tracks:', _e);
		}
	}

	async function checkEligibility() {
		checkingAtprotofans = true;
		try {
			atprotofansEligible = await checkAtprotofansEligibility(auth.user?.did);
		} finally {
			checkingAtprotofans = false;
		}
	}

	async function logout() {
		await auth.logout();
		window.location.href = '/';
	}

	onMount(async () => {
		while (auth.loading) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		if (!auth.isAuthenticated) {
			window.location.href = '/login';
			return;
		}
		await Promise.all([loadTracks(), checkEligibility()]);
		loading = false;
	});
</script>

{#if loading}
	<div class="loading">
		<WaveLoading size="lg" message="loading..." />
	</div>
{:else if auth.user}
	<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={logout} />
	<main>
		<div class="manage-header">
			<a href="/portal" class="back-link">← portal</a>
			<h2>manage</h2>
			<p class="manage-subtitle">profile, rights, sharing, and data</p>
		</div>

		<ProfileSection {atprotofansEligible} {checkingAtprotofans} />

		<CopyrightSection />

		<SharesSection />

		<DataSection {tracks} {tracksTotal} loadMyTracks={loadTracks} />
	</main>
{/if}

<style>
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: var(--text-tertiary);
		gap: 1rem;
	}

	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 120px) + 2rem + env(safe-area-inset-bottom, 0px));
	}

	.manage-header {
		margin-bottom: 2rem;
	}

	.back-link {
		display: inline-block;
		color: var(--text-secondary);
		text-decoration: none;
		font-size: var(--text-sm);
		margin-bottom: 0.75rem;
		transition: color 0.15s;
	}

	.back-link:hover {
		color: var(--accent);
	}

	.manage-header h2 {
		font-size: var(--text-page-heading);
		margin: 0;
	}

	.manage-subtitle {
		margin: 0.35rem 0 0;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	@media (max-width: 600px) {
		main {
			padding: 0 0.75rem calc(var(--player-height, 120px) + 1.5rem + env(safe-area-inset-bottom, 0px));
		}

		.manage-header {
			margin-bottom: 1.25rem;
		}

		.manage-header h2 {
			font-size: var(--text-2xl);
		}
	}
</style>
