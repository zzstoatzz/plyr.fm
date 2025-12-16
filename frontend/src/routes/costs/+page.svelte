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

	interface DailyData {
		date: string;
		scans: number;
		flagged: number;
		requests: number;
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
			audd: {
				amount: number;
				base_cost: number;
				overage_cost: number;
				scans_this_period: number;
				requests_this_period: number;
				audio_seconds: number;
				free_requests: number;
				remaining_free: number;
				billable_requests: number;
				flag_rate: number;
				daily: DailyData[];
				note: string;
			};
		};
		support: {
			kofi: string;
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
					data.costs.cloudflare.amount,
					data.costs.audd.amount
				)
			: 1
	);

	let maxRequests = $derived(
		data?.costs.audd.daily.length
			? Math.max(...data.costs.audd.daily.map((d) => d.requests))
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

				<div class="cost-item">
					<div class="cost-header">
						<span class="cost-name">audd</span>
						<span class="cost-amount">{formatCurrency(data.costs.audd.amount)}</span>
					</div>
					<div class="cost-bar-bg">
						<div
							class="cost-bar audd"
							style="width: {barWidth(data.costs.audd.amount, maxCost)}%"
						></div>
					</div>
					<span class="cost-note">{data.costs.audd.note}</span>
				</div>
			</div>
		</section>

		<!-- audd details -->
		<section class="audd-section">
			<h2>copyright scanning (audd)</h2>
			<div class="audd-stats">
				<div class="stat">
					<span class="stat-value">{data.costs.audd.requests_this_period.toLocaleString()}</span>
					<span class="stat-label">API requests</span>
				</div>
				<div class="stat">
					<span class="stat-value">{data.costs.audd.remaining_free.toLocaleString()}</span>
					<span class="stat-label">free remaining</span>
				</div>
				<div class="stat">
					<span class="stat-value">{data.costs.audd.scans_this_period.toLocaleString()}</span>
					<span class="stat-label">tracks scanned</span>
				</div>
			</div>

			<p class="audd-explainer">
				1 request = 12s of audio. {data.costs.audd.free_requests.toLocaleString()} free/month,
				then ${(5).toFixed(2)}/1k requests.
				{#if data.costs.audd.billable_requests > 0}
					<strong>{data.costs.audd.billable_requests.toLocaleString()} billable</strong> this period.
				{/if}
			</p>

			{#if data.costs.audd.daily.length > 0}
				<div class="daily-chart">
					<h3>daily requests</h3>
					<div class="chart-bars">
						{#each data.costs.audd.daily as day}
							<div class="chart-bar-container">
								<div
									class="chart-bar"
									style="height: {Math.max(4, (day.requests / maxRequests) * 100)}%"
									title="{day.date}: {day.requests} requests ({day.scans} tracks)"
								></div>
								<span class="chart-label">{day.date.slice(5)}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
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
				<a href={data.support.kofi} target="_blank" rel="noopener" class="kofi-button">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
						<path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.831 6.649-6.916zm-11.062 3.511c-1.246 1.453-4.011 3.976-4.011 3.976s-.121.119-.31.023c-.076-.057-.108-.09-.108-.09-.443-.441-3.368-3.049-4.034-3.954-.709-.965-1.041-2.7-.091-3.71.951-1.01 3.005-1.086 4.363.407 0 0 1.565-1.782 3.468-.963 1.904.82 1.832 3.011.723 4.311zm6.173.478c-.928.116-1.682.028-1.682.028V7.284h1.77s1.971.551 1.971 2.638c0 1.913-.985 2.667-2.059 3.015z"/>
					</svg>
					buy me a coffee
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
		font-size: 0.9rem;
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
		font-size: 0.85rem;
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
		border-radius: 12px;
	}

	.total-label {
		font-size: 0.8rem;
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
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin-top: 0.75rem;
	}

	/* breakdown section */
	.breakdown-section {
		margin-bottom: 2rem;
	}

	.breakdown-section h2,
	.audd-section h2 {
		font-size: 0.8rem;
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
		border-radius: 8px;
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
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: 0.5rem;
	}

	.cost-bar {
		height: 100%;
		background: var(--accent);
		border-radius: 4px;
		transition: width 0.3s ease;
	}

	.cost-bar.audd {
		background: var(--warning);
	}

	.cost-note {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	/* audd section */
	.audd-section {
		margin-bottom: 2rem;
	}

	.audd-stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.audd-explainer {
		font-size: 0.8rem;
		color: var(--text-secondary);
		margin-bottom: 1.5rem;
		line-height: 1.5;
	}

	.audd-explainer strong {
		color: var(--warning);
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		text-align: center;
		margin-top: 0.25rem;
	}

	/* daily chart */
	.daily-chart {
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
		padding: 1rem;
	}

	.daily-chart h3 {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
		margin: 0 0 1rem;
	}

	.chart-bars {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		height: 100px;
	}

	.chart-bar-container {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		height: 100%;
	}

	.chart-bar {
		width: 100%;
		background: var(--accent);
		border-radius: 2px 2px 0 0;
		min-height: 4px;
		margin-top: auto;
		transition: height 0.3s ease;
	}

	.chart-bar:hover {
		opacity: 0.8;
	}

	.chart-label {
		font-size: 0.6rem;
		color: var(--text-tertiary);
		margin-top: 0.5rem;
		white-space: nowrap;
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
		border-radius: 12px;
	}

	.support-icon {
		color: var(--accent);
		margin-bottom: 1rem;
	}

	.support-text h3 {
		margin: 0 0 0.5rem;
		font-size: 1.1rem;
		color: var(--text-primary);
	}

	.support-text p {
		margin: 0 0 1.5rem;
		color: var(--text-secondary);
		font-size: 0.9rem;
	}

	.kofi-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: #ff5e5b;
		color: white;
		border-radius: 8px;
		text-decoration: none;
		font-weight: 600;
		font-size: 0.9rem;
		transition: transform 0.15s, box-shadow 0.15s;
	}

	.kofi-button:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(255, 94, 91, 0.3);
	}

	/* footer */
	.footer-note {
		text-align: center;
		font-size: 0.8rem;
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

		.audd-stats {
			grid-template-columns: 1fr;
		}

		.chart-label {
			display: none;
		}
	}
</style>
