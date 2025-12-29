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

	let maxRequests = $derived.by(() => {
		return filteredDaily.length ? Math.max(...filteredDaily.map((d) => d.requests)) : 1;
	});

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
			<div class="audd-header">
				<h2>api requests (audd)</h2>
				<div class="time-range-toggle">
					<button
						class:active={timeRange === 'day'}
						onclick={() => (timeRange = 'day')}
					>
						24h
					</button>
					<button
						class:active={timeRange === 'week'}
						onclick={() => (timeRange = 'week')}
					>
						7d
					</button>
					<button
						class:active={timeRange === 'month'}
						onclick={() => (timeRange = 'month')}
					>
						30d
					</button>
				</div>
			</div>

			<div class="audd-stats">
				<div class="stat">
					<span class="stat-value">{filteredTotals.requests.toLocaleString()}</span>
					<span class="stat-label">requests ({timeRange === 'day' ? '24h' : timeRange === 'week' ? '7d' : '30d'})</span>
				</div>
				<div class="stat">
					<span class="stat-value">{data.costs.audd.remaining_free.toLocaleString()}</span>
					<span class="stat-label">free remaining</span>
				</div>
				<div class="stat">
					<span class="stat-value">{filteredTotals.scans.toLocaleString()}</span>
					<span class="stat-label">tracks scanned</span>
				</div>
			</div>

			<p class="audd-explainer">
				1 request = 12s of audio. {data.costs.audd.free_requests.toLocaleString()} free/month,
				then ${(5).toFixed(2)}/1k requests.
				{#if data.costs.audd.billable_requests > 0}
					<strong>{data.costs.audd.billable_requests.toLocaleString()} billable</strong> this billing period.
				{/if}
			</p>

			{#if filteredDaily.length > 0}
				<div class="daily-chart">
					<h3>daily requests</h3>
					<div class="chart-bars">
						{#each filteredDaily as day}
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
			{:else}
				<p class="no-data">no requests in this time range</p>
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

	.audd-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		gap: 1rem;
	}

	.audd-header h2 {
		margin-bottom: 0;
	}

	.time-range-toggle {
		display: flex;
		gap: 0.25rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: 6px;
		padding: 0.25rem;
	}

	.time-range-toggle button {
		padding: 0.35rem 0.75rem;
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		background: transparent;
		border: none;
		border-radius: 4px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.time-range-toggle button:hover {
		color: var(--text-primary);
	}

	.time-range-toggle button.active {
		background: var(--accent);
		color: white;
	}

	.no-data {
		text-align: center;
		color: var(--text-tertiary);
		font-size: 0.85rem;
		padding: 2rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
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
		overflow: hidden;
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
		gap: 2px;
		height: 100px;
		width: 100%;
	}

	.chart-bar-container {
		flex: 1 1 0;
		min-width: 0;
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
		font-size: 0.55rem;
		color: var(--text-tertiary);
		margin-top: 0.25rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
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

	.support-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: var(--accent);
		color: white;
		border-radius: 8px;
		text-decoration: none;
		font-weight: 600;
		font-size: 0.9rem;
		transition: transform 0.15s, box-shadow 0.15s;
	}

	.support-button:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent);
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
