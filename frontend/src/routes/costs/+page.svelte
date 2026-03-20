<script lang="ts">
	import { onMount } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import WaveLoading from '$lib/components/WaveLoading.svelte';
	import { auth } from '$lib/auth.svelte';
	import { APP_NAME } from '$lib/branding';
	import { API_URL } from '$lib/config';

	interface CostBreakdown {
		[key: string]: number;
	}

	interface ScanDailyData {
		date: string;
		scans: number;
		flagged: number;
	}

	interface CostData {
		generated_at: string;
		monthly_estimate: number;
		costs: {
			fly_io: {
				amount: number;
				breakdown: CostBreakdown;
				note: string;
			};
			neon: {
				amount: number;
				note: string;
			};
			cloudflare: {
				amount: number;
				breakdown: CostBreakdown;
				note: string;
			};
			copyright_scanning: {
				amount: number;
				scans_30d: number;
				flagged_30d: number;
				flag_rate: number;
				daily: ScanDailyData[];
				note: string;
			};
		};
		support: {
			url: string;
			message: string;
		};
	}

	let loading = $state(true);
	let error = $state<string | null>(null);
	let data = $state<CostData | null>(null);
	// derived values for bar chart scaling
	let maxCost = $derived(
		data
			? Math.max(
					data.costs.fly_io.amount,
					data.costs.neon.amount,
					data.costs.cloudflare.amount
				)
			: 1
	);

	onMount(async () => {
		try {
			const response = await fetch(`${API_URL}/stats/costs`);
			if (!response.ok) {
				throw new Error(`failed to load cost data: ${response.status}`);
			}
			data = await response.json();
		} catch (e) {
			console.error('failed to load costs:', e);
			error = e instanceof Error ? e.message : 'failed to load cost data';
		} finally {
			loading = false;
		}
	});

	function formatDate(isoString: string): string {
		const date = new Date(isoString);
		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function formatCurrency(amount: number): string {
		return `$${amount.toFixed(2)}`;
	}

	// calculate bar width as percentage of max
	function barWidth(amount: number, max: number): number {
		return Math.max(5, (amount / max) * 100);
	}

	async function logout() {
		await auth.logout();
		window.location.href = '/';
	}
</script>

<svelte:head>
	<title>platform costs | {APP_NAME}</title>
	<meta name="description" content="transparency dashboard showing {APP_NAME} running costs" />
</svelte:head>

<Header user={auth.user} isAuthenticated={auth.isAuthenticated} onLogout={logout} />

<main>
	<div class="page-header">
		<h1>platform costs</h1>
		<p class="subtitle">transparency dashboard for {APP_NAME} infrastructure</p>
	</div>

	{#if loading}
		<div class="loading">
			<WaveLoading size="md" message="loading cost data..." />
		</div>
	{:else if error}
		<div class="error-state">
			<p>{error}</p>
			<p class="hint">cost data is updated daily. check back later.</p>
		</div>
	{:else if data}
		<!-- monthly total -->
		<section class="total-section">
			<div class="total-card">
				<span class="total-label">estimated monthly</span>
				<span class="total-amount">{formatCurrency(data.monthly_estimate)}</span>
			</div>
			<p class="updated">last updated: {formatDate(data.generated_at)}</p>
		</section>

		<!-- cost breakdown -->
		<section class="breakdown-section">
			<h2>breakdown</h2>

			<div class="cost-bars">
				<div class="cost-item">
					<div class="cost-header">
						<span class="cost-name">fly.io</span>
						<span class="cost-amount">{formatCurrency(data.costs.fly_io.amount)}</span>
					</div>
					<div class="cost-bar-bg">
						<div
							class="cost-bar"
							style="width: {barWidth(data.costs.fly_io.amount, maxCost)}%"
						></div>
					</div>
					<span class="cost-note">{data.costs.fly_io.note}</span>
				</div>

				<div class="cost-item">
					<div class="cost-header">
						<span class="cost-name">neon</span>
						<span class="cost-amount">{formatCurrency(data.costs.neon.amount)}</span>
					</div>
					<div class="cost-bar-bg">
						<div
							class="cost-bar"
							style="width: {barWidth(data.costs.neon.amount, maxCost)}%"
						></div>
					</div>
					<span class="cost-note">{data.costs.neon.note}</span>
				</div>

				<div class="cost-item">
					<div class="cost-header">
						<span class="cost-name">cloudflare</span>
						<span class="cost-amount">{formatCurrency(data.costs.cloudflare.amount)}</span>
					</div>
					<div class="cost-bar-bg">
						<div
							class="cost-bar"
							style="width: {barWidth(data.costs.cloudflare.amount, maxCost)}%"
						></div>
					</div>
					<span class="cost-note">{data.costs.cloudflare.note}</span>
				</div>

			</div>
		</section>

		<!-- copyright scanning -->
		<section class="scanning-section">
			<div class="cost-item">
				<div class="cost-header">
					<span class="cost-name">copyright scanning</span>
					<span class="cost-amount free">free</span>
				</div>
				<span class="cost-note">{data.costs.copyright_scanning.note}</span>
				{#if data.costs.copyright_scanning.scans_30d > 0}
					<span class="cost-note">
						{data.costs.copyright_scanning.scans_30d} scans last 30 days
						({data.costs.copyright_scanning.flag_rate}% flagged)
					</span>
				{/if}
			</div>
		</section>

		<!-- support cta -->
		<section class="support-section">
			<div class="support-card">
				<div class="support-icon">
					<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
					</svg>
				</div>
				<div class="support-text">
					<h3>support {APP_NAME}</h3>
					<p>{data.support.message}</p>
				</div>
				<a href={data.support.url} target="_blank" rel="noopener" class="support-button">
					support
				</a>
			</div>
		</section>

		<!-- footer note -->
		<p class="footer-note">
			{APP_NAME} is an open-source project.
			<a href="https://github.com/zzstoatzz/plyr.fm" target="_blank" rel="noopener">view source</a>
		</p>
	{/if}
</main>

<style>
	main {
		max-width: 600px;
		margin: 0 auto;
		padding: 0 1rem calc(var(--player-height, 120px) + 2rem + env(safe-area-inset-bottom, 0px));
	}

	.page-header {
		margin-bottom: 2rem;
	}

	.page-header h1 {
		font-size: var(--text-page-heading);
		margin: 0 0 0.5rem;
	}

	.subtitle {
		color: var(--text-tertiary);
		font-size: var(--text-base);
		margin: 0;
	}

	.loading {
		display: flex;
		justify-content: center;
		padding: 4rem 0;
	}

	.error-state {
		text-align: center;
		padding: 3rem 1rem;
		color: var(--text-secondary);
	}

	.error-state .hint {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		margin-top: 0.5rem;
	}

	/* total section */
	.total-section {
		margin-bottom: 2rem;
	}

	.total-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
	}

	.total-label {
		font-size: var(--text-sm);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary);
		margin-bottom: 0.5rem;
	}

	.total-amount {
		font-size: 3rem;
		font-weight: 700;
		color: var(--accent);
	}

	.updated {
		text-align: center;
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		margin-top: 0.75rem;
	}

	/* breakdown section */
	.breakdown-section {
		margin-bottom: 2rem;
	}

	.breakdown-section h2 {
		font-size: var(--text-sm);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary);
		margin-bottom: 1rem;
	}

	.cost-bars {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.cost-item {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-md);
		padding: 1rem;
	}

	.cost-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.cost-name {
		font-weight: 600;
		color: var(--text-primary);
	}

	.cost-amount {
		font-weight: 600;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}

	.cost-bar-bg {
		height: 8px;
		background: var(--bg-primary);
		border-radius: var(--radius-sm);
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.cost-bar {
		height: 100%;
		background: var(--accent);
		border-radius: var(--radius-sm);
		transition: width 0.3s ease;
	}

	.cost-note {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
	}

	/* scanning section */
	.scanning-section {
		margin-bottom: 2rem;
	}

	.cost-amount.free {
		color: var(--success, #4caf50);
	}

	/* support section */
	.support-section {
		margin-bottom: 2rem;
	}

	.support-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 2rem;
		background: linear-gradient(135deg,
			color-mix(in srgb, var(--accent) 10%, var(--bg-tertiary)),
			var(--bg-tertiary)
		);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-lg);
	}

	.support-icon {
		color: var(--accent);
		margin-bottom: 1rem;
	}

	.support-text h3 {
		margin: 0 0 0.5rem;
		font-size: var(--text-xl);
		color: var(--text-primary);
	}

	.support-text p {
		margin: 0 0 1.5rem;
		color: var(--text-secondary);
		font-size: var(--text-base);
	}

	.support-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: var(--accent);
		color: white;
		border-radius: var(--radius-md);
		text-decoration: none;
		font-weight: 600;
		font-size: var(--text-base);
		transition: transform 0.15s, box-shadow 0.15s;
	}

	.support-button:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	/* footer */
	.footer-note {
		text-align: center;
		font-size: var(--text-sm);
		color: var(--text-tertiary);
		padding-bottom: 1rem;
	}

	.footer-note a {
		color: var(--accent);
		text-decoration: none;
	}

	.footer-note a:hover {
		text-decoration: underline;
	}

	@media (max-width: 480px) {
		.total-amount {
			font-size: 2.5rem;
		}
	}
</style>
