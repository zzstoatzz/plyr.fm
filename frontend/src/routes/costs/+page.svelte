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
			upstash?: {
				amount: number;
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
			url: string;
			message: string;
		};
	}

	let loading = $state(true);
	let error = $state<string | null>(null);
	let data = $state<CostData | null>(null);
	let timeRange = $state<'day' | 'week' | 'month'>('month');

	// filter daily data based on selected time range
	// returns the last N days of data based on selection
	let filteredDaily = $derived.by(() => {
		if (!data?.costs.audd.daily.length) return [];
		const daily = data.costs.audd.daily;
		if (timeRange === 'day') {
			// show last 2 days (today + yesterday) for 24h view
			return daily.slice(-2);
		} else if (timeRange === 'week') {
			// show last 7 days
			return daily.slice(-7);
		} else {
			// show all (up to 30 days)
			return daily;
		}
	});

	// calculate totals for selected time range
	let filteredTotals = $derived.by(() => {
		return {
			requests: filteredDaily.reduce((sum, d) => sum + d.requests, 0),
			scans: filteredDaily.reduce((sum, d) => sum + d.scans, 0)
		};
	});

	// derived values for bar chart scaling
	let maxCost = $derived(
		data
			? Math.max(
					data.costs.fly_io.amount,
					data.costs.neon.amount,
					data.costs.cloudflare.amount,
					data.costs.upstash?.amount ?? 0,
					data.costs.audd.amount
				)
			: 1
	);

	// derive max requests for the daily chart based on filtered data
	let maxRequests = $derived(
		filteredDaily.length > 0 ? Math.max(...filteredDaily.map((d) => d.requests), 1) : 1
	);

	function formatCurrency(amount: number): string {
		return `$${amount.toFixed(2)}`;
	}

	function formatDate(isoString: string): string {
		return new Date(isoString).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function formatShortDate(isoString: string): string {
		return new Date(isoString).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric'
		});
	}

	function barWidth(amount: number, max: number): number {
		if (max === 0) return 0;
		return Math.max((amount / max) * 100, 2); // minimum 2% for visibility
	}

	onMount(async () => {
		try {
			const res = await fetch(`${API_URL}/stats/costs`);
			if (!res.ok) throw new Error('failed to load costs');
			data = await res.json();
		} catch (e) {
			error = e instanceof Error ? e.message : 'unknown error';
		} finally {
			loading = false;
		}
	});

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

				{#if data.costs.upstash}
					<div class="cost-item">
						<div class="cost-header">
							<span class="cost-name">upstash</span>
							<span class="cost-amount">{formatCurrency(data.costs.upstash.amount)}</span>
						</div>
						<div class="cost-bar-bg">
							<div
								class="cost-bar"
								style="width: {barWidth(data.costs.upstash.amount, maxCost)}%"
							></div>
						</div>
						<span class="cost-note">{data.costs.upstash.note}</span>
					</div>
				{/if}

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
			<h2>copyright detection (audd)</h2>

			<div class="audd-stats">
				<div class="stat">
					<span class="stat-value">{data.costs.audd.scans_this_period.toLocaleString()}</span>
					<span class="stat-label">tracks scanned</span>
				</div>
				<div class="stat">
					<span class="stat-value">{data.costs.audd.requests_this_period.toLocaleString()}</span>
					<span class="stat-label">api requests</span>
				</div>
				<div class="stat">
					<span class="stat-value">{data.costs.audd.remaining_free.toLocaleString()}</span>
					<span class="stat-label">free remaining</span>
				</div>
				<div class="stat">
					<span class="stat-value">{data.costs.audd.flag_rate}%</span>
					<span class="stat-label">flag rate</span>
				</div>
			</div>

			<!-- daily chart with time range toggle -->
			{#if data.costs.audd.daily.length > 0}
				<div class="daily-chart-container">
					<div class="chart-header">
						<h3>daily requests</h3>
						<div class="time-toggle">
							<button
								class="toggle-btn"
								class:active={timeRange === 'day'}
								onclick={() => (timeRange = 'day')}
							>
								24h
							</button>
							<button
								class="toggle-btn"
								class:active={timeRange === 'week'}
								onclick={() => (timeRange = 'week')}
							>
								7d
							</button>
							<button
								class="toggle-btn"
								class:active={timeRange === 'month'}
								onclick={() => (timeRange = 'month')}
							>
								30d
							</button>
						</div>
					</div>
					<div class="chart-summary">
						<span>{filteredTotals.requests.toLocaleString()} requests</span>
						<span class="separator">·</span>
						<span>{filteredTotals.scans.toLocaleString()} scans</span>
					</div>
					<div class="daily-chart">
						{#each filteredDaily as day}
							<div class="day-bar-container">
								<div
									class="day-bar"
									style="height: {barWidth(day.requests, maxRequests)}%"
									title="{formatShortDate(day.date)}: {day.requests} requests, {day.scans} scans"
								></div>
								<span class="day-label">{formatShortDate(day.date)}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</section>

		<!-- support cta -->
		<section class="support-section">
			<p>{data.support.message}</p>
			<a href={data.support.url} target="_blank" rel="noopener noreferrer" class="support-link">
				become a supporter →
			</a>
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 600px;
		margin: 0 auto;
		padding: 2rem 1rem 6rem;
	}

	.page-header {
		margin-bottom: 2rem;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
		margin: 0 0 0.25rem;
	}

	.subtitle {
		color: var(--text-secondary);
		font-size: 0.875rem;
		margin: 0;
	}

	.loading,
	.error-state {
		text-align: center;
		padding: 3rem 1rem;
	}

	.error-state p {
		margin: 0.5rem 0;
	}

	.hint {
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	/* total section */
	.total-section {
		text-align: center;
		margin-bottom: 2rem;
	}

	.total-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.total-label {
		font-size: 0.875rem;
		color: var(--text-secondary);
		text-transform: lowercase;
	}

	.total-amount {
		font-size: 2.5rem;
		font-weight: 700;
		color: var(--accent);
	}

	.updated {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-top: 0.5rem;
	}

	/* breakdown section */
	.breakdown-section {
		margin-bottom: 2rem;
	}

	.breakdown-section h2 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		text-transform: lowercase;
	}

	.cost-bars {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.cost-item {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.cost-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.cost-name {
		font-weight: 500;
		font-size: 0.875rem;
	}

	.cost-amount {
		font-weight: 600;
		font-size: 0.875rem;
	}

	.cost-bar-bg {
		height: 8px;
		background: var(--surface);
		border-radius: 4px;
		overflow: hidden;
	}

	.cost-bar {
		height: 100%;
		background: var(--accent);
		border-radius: 4px;
		transition: width 0.3s ease;
	}

	.cost-bar.audd {
		background: linear-gradient(90deg, var(--accent), var(--accent-hover));
	}

	.cost-note {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	/* audd section */
	.audd-section {
		margin-bottom: 2rem;
	}

	.audd-section h2 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 1rem;
		text-transform: lowercase;
	}

	.audd-stats {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.stat {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 600;
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
		text-transform: lowercase;
	}

	/* daily chart */
	.daily-chart-container {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1rem;
	}

	.daily-chart-container h3 {
		font-size: 0.875rem;
		font-weight: 500;
		margin: 0 0 0.75rem;
		text-transform: lowercase;
	}

	.chart-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.chart-header h3 {
		margin: 0;
	}

	.time-toggle {
		display: flex;
		gap: 0.25rem;
		background: var(--background);
		border-radius: 6px;
		padding: 2px;
	}

	.toggle-btn {
		background: transparent;
		border: none;
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
		cursor: pointer;
		border-radius: 4px;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.toggle-btn:hover {
		color: var(--text-primary);
	}

	.toggle-btn.active {
		background: var(--surface);
		color: var(--text-primary);
		font-weight: 500;
	}

	.chart-summary {
		font-size: 0.75rem;
		color: var(--text-secondary);
		margin-bottom: 0.75rem;
	}

	.chart-summary .separator {
		margin: 0 0.5rem;
	}

	.daily-chart {
		display: flex;
		gap: 2px;
		height: 80px;
		align-items: flex-end;
		overflow-x: auto;
	}

	.day-bar-container {
		flex: 1;
		min-width: 20px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		height: 100%;
	}

	.day-bar {
		width: 100%;
		background: var(--accent);
		border-radius: 2px 2px 0 0;
		min-height: 2px;
		cursor: help;
		transition: opacity 0.15s;
	}

	.day-bar:hover {
		opacity: 0.8;
	}

	.day-label {
		font-size: 0.625rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	/* support section */
	.support-section {
		text-align: center;
		padding: 1.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 12px;
	}

	.support-section p {
		margin: 0 0 1rem;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	.support-link {
		display: inline-block;
		color: var(--accent);
		font-weight: 500;
		text-decoration: none;
	}

	.support-link:hover {
		text-decoration: underline;
	}

	@media (max-width: 480px) {
		.total-amount {
			font-size: 2rem;
		}

		.audd-stats {
			grid-template-columns: 1fr 1fr;
		}

		.day-label {
			display: none;
		}
	}
</style>
