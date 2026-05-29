<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll, replaceState } from '$app/navigation';
	import Header from '$lib/components/Header.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import MigrationBanner from '$lib/components/MigrationBanner.svelte';
	import BrokenTracks from '$lib/components/BrokenTracks.svelte';
	import PortalIdentity from '$lib/components/portal/PortalIdentity.svelte';
	import PlaylistsSection from '$lib/components/portal/PlaylistsSection.svelte';
	import TracksSection from '$lib/components/portal/TracksSection.svelte';
	import AlbumsSection from '$lib/components/portal/AlbumsSection.svelte';
	import type { Track, AlbumSummary } from '$lib/types';
	import { API_URL } from '$lib/config';
	import { toast } from '$lib/toast.svelte';
	import { auth } from '$lib/auth.svelte';
	import { checkAtprotofansEligibility } from '$lib/utils/atprotofans';
	import { preferences } from '$lib/preferences.svelte'; import { getReturnUrl, clearReturnUrl } from '$lib/utils/return-url';

	let loading = $state(true);
	let error = $state('');
	let tracks = $state<Track[]>([]);
	let tracksTotal = $state(0);
	let tracksHasMore = $state(false);
	let loadingTracks = $state(false);
	let loadingMoreTracks = $state(false);
	// atprotofans eligibility - checked on mount; gates the supporter toggle in TracksSection
	let atprotofansEligible = $state(false);

	// album management state
	let albums = $state<AlbumSummary[]>([]);
	let loadingAlbums = $state(false);

	onMount(async () => {
		// check if exchange_token is in URL (from OAuth callback for regular login)
		const params = new URLSearchParams(window.location.search);
		const exchangeToken = params.get('exchange_token');
		const isDevToken = params.get('dev_token') === 'true';
		const isScopeUpgrade = params.get('scope_upgraded') === 'true';

		// redirect dev token callbacks to settings page
		if (exchangeToken && isDevToken) {
			window.location.href = `/settings?exchange_token=${exchangeToken}&dev_token=true`;
			return;
		}

		if (exchangeToken) {
			// regular login - exchange token for session
			try {
				const exchangeResponse = await fetch(`${API_URL}/auth/exchange`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ exchange_token: exchangeToken })
				});

				if (exchangeResponse.ok) {
					// invalidate all load functions so they rerun with the new session cookie
					await invalidateAll();
					await auth.refresh();
					await preferences.fetch();
					if (isScopeUpgrade) {
						toast.success('copyright paradigm configured');
					} else {
						const r = getReturnUrl();
						if (r) {
							clearReturnUrl();
							window.location.href = r;
							return;
						}
					}
				}
			} catch (_e) {
				console.error('failed to exchange token:', _e);
			}

			replaceState('/portal', {});
		}

		// wait for auth to finish loading
		while (auth.loading) {
			await new Promise(resolve => setTimeout(resolve, 50));
		}

		if (!auth.isAuthenticated) {
			window.location.href = '/login';
			return;
		}

		try {
			await Promise.all([
				loadMyTracks(),
				loadAtprotofansEligibility(),
				loadMyAlbums()
			]);
		} catch (_e) {
			console.error('error loading portal data:', _e);
			error = 'failed to load portal data';
		} finally {
			loading = false;
		}
	});

	async function loadMyTracks(append = false) {
		if (append) {
			loadingMoreTracks = true;
		} else {
			loadingTracks = true;
		}
		try {
			const offset = append ? tracks.length : 0;
			const response = await fetch(`${API_URL}/tracks/me?limit=10&offset=${offset}`, {
				credentials: 'include'
			});
			if (response.ok) {
				const data = await response.json();
				if (append) {
					tracks = [...tracks, ...data.tracks];
				} else {
					tracks = data.tracks;
				}
				tracksTotal = data.total;
				tracksHasMore = data.has_more;
			}
		} catch (_e) {
			console.error('failed to load tracks:', _e);
		} finally {
			loadingTracks = false;
			loadingMoreTracks = false;
		}
	}

	async function loadAtprotofansEligibility() {
		atprotofansEligible = await checkAtprotofansEligibility(auth.user?.did);
	}

	async function loadMyAlbums() {
		if (!auth.user) return;
		loadingAlbums = true;
		try {
			const response = await fetch(`${API_URL}/albums/${auth.user.handle}`);
			if (response.ok) {
				const data = await response.json();
				albums = data.albums;
			}
		} catch (_e) {
			console.error('failed to load albums:', _e);
		} finally {
			loadingAlbums = false;
		}
	}

	async function reloadTracksAndAlbums() {
		await loadMyTracks();
		await loadMyAlbums();
	}

	async function logout() {
		await auth.logout();
		window.location.href = '/';
	}
</script>

{#if loading}
	<div class="loading">
		<WaveLoading size="lg" message="loading..." />
	</div>
{:else if error}
	<div class="error-container">
		<h1>{error}</h1>
		<a href="/">go home</a>
	</div>
{:else if auth.user}
	<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={logout} />
	<main>
		<MigrationBanner />
		<BrokenTracks />

		<div class="portal-header">
			<h2>artist portal</h2>
		</div>

		<PortalIdentity trackCount={tracksTotal} albumCount={albums.length} />

		<a href="/upload" class="upload-card">
			<div class="upload-card-icon">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
					<polyline points="17 8 12 3 7 8"></polyline>
					<line x1="12" y1="3" x2="12" y2="15"></line>
				</svg>
			</div>
			<div class="upload-card-text">
				<span class="upload-card-title">upload track</span>
				<span class="upload-card-subtitle">add new music</span>
			</div>
			<svg class="upload-card-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="9 18 15 12 9 6"></polyline>
			</svg>
		</a>

		<a href="/portal/manage" class="upload-card">
			<div class="upload-card-icon">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="4" y1="21" x2="4" y2="14"></line>
					<line x1="4" y1="10" x2="4" y2="3"></line>
					<line x1="12" y1="21" x2="12" y2="12"></line>
					<line x1="12" y1="8" x2="12" y2="3"></line>
					<line x1="20" y1="21" x2="20" y2="16"></line>
					<line x1="20" y1="12" x2="20" y2="3"></line>
					<line x1="1" y1="14" x2="7" y2="14"></line>
					<line x1="9" y1="8" x2="15" y2="8"></line>
					<line x1="17" y1="16" x2="23" y2="16"></line>
				</svg>
			</div>
			<div class="upload-card-text">
				<span class="upload-card-title">manage</span>
				<span class="upload-card-subtitle">profile, rights, sharing, data</span>
			</div>
			<svg class="upload-card-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="9 18 15 12 9 6"></polyline>
			</svg>
		</a>

		<TracksSection
			tracks={tracks}
			tracksTotal={tracksTotal}
			tracksHasMore={tracksHasMore}
			loadingTracks={loadingTracks}
			loadingMoreTracks={loadingMoreTracks}
			albums={albums}
			atprotofansEligible={atprotofansEligible}
			onLoadMore={() => loadMyTracks(true)}
			onTracksChanged={reloadTracksAndAlbums}
		/>

		<AlbumsSection albums={albums} loadingAlbums={loadingAlbums} />

		<PlaylistsSection />
	</main>
{/if}

<style>
	.loading,
	.error-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		color: var(--text-tertiary);
		gap: 1rem;
	}

	.error-container a {
		color: var(--accent);
		text-decoration: none;
	}

	.error-container a:hover {
		text-decoration: underline;
	}

	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 120px) + 2rem + env(safe-area-inset-bottom, 0px));
	}

	.portal-header {
		margin-bottom: 2rem;
	}

	.portal-header h2 {
		font-size: var(--text-page-heading);
		margin: 0;
	}

	/* upload card */
	.upload-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		text-decoration: none;
		color: var(--text-primary);
		transition: all 0.15s;
		margin-bottom: 2rem;
	}

	.upload-card:hover {
		border-color: var(--accent);
		background: var(--bg-hover);
	}

	.upload-card:active {
		transform: scale(0.99);
	}

	.upload-card-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		background: color-mix(in srgb, var(--accent) 15%, transparent);
		border-radius: var(--radius-md);
		color: var(--accent);
		flex-shrink: 0;
	}

	.upload-card-text {
		flex: 1;
		min-width: 0;
	}

	.upload-card-title {
		display: block;
		font-weight: 600;
		font-size: var(--text-base);
		color: var(--text-primary);
	}

	.upload-card-subtitle {
		display: block;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
	}

	.upload-card-chevron {
		color: var(--text-muted);
		flex-shrink: 0;
		transition: transform 0.15s;
	}

	.upload-card:hover .upload-card-chevron {
		transform: translateX(2px);
		color: var(--accent);
	}

	/* mobile responsive */
	@media (max-width: 600px) {
		main {
			padding: 0 0.75rem calc(var(--player-height, 120px) + 1.5rem + env(safe-area-inset-bottom, 0px));
		}

		.portal-header {
			margin-bottom: 1.25rem;
		}

		.portal-header h2 {
			font-size: var(--text-2xl);
		}

		/* upload card mobile */
		.upload-card {
			padding: 0.85rem 1rem;
			margin-bottom: 1.5rem;
		}

		.upload-card-icon {
			width: 40px;
			height: 40px;
		}

		.upload-card-icon svg {
			width: 20px;
			height: 20px;
		}

		.upload-card-title {
			font-size: var(--text-base);
		}

		.upload-card-subtitle {
			font-size: var(--text-xs);
		}
	}
</style>
