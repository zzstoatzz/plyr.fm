import type { StatsRange } from '@plyr/next-core/api';

export const ranges: { value: StatsRange; label: string }[] = [
	{ value: 'week', label: '7 days' },
	{ value: 'month', label: '30 days' },
	{ value: 'year', label: 'year' },
	{ value: 'all', label: 'all time' }
];

export function parseRange(value: string | null): StatsRange {
	return ranges.some(range => range.value === value) ? value as StatsRange : 'month';
}

/** How the page talks about a range: "plays in the last 30 days", "3.2× the 30 days before". */
export function rangeSpan(range: StatsRange) {
	switch (range) {
		case 'week': return { phrase: 'in the last 7 days', before: 'the 7 days before', short: 'last 7 days' };
		case 'month': return { phrase: 'in the last 30 days', before: 'the 30 days before', short: 'last 30 days' };
		case 'year': return { phrase: 'in the last year', before: 'the year before', short: 'last year' };
		case 'all': return { phrase: 'all time', before: '', short: 'all time' };
	}
}

/** What one bar covers, for the legend: "3 hours", "a day". */
export const barSpan = (hours: number) => hours === 24 ? 'a day' : `${hours} hours`;

/** What the running-average line averages over, for the legend. */
export const averageSpan = (hours: number) => hours === 24 ? '7-day average' : 'daily average';

/** How many bars the running average spans: a week of days, or a day of shorter bars. */
export const averageBars = (hours: number) => hours === 24 ? 7 : Math.max(1, Math.round(24 / hours));

/** Axis labels: each bar that starts a new day (short bars, in the viewer's time) or a new month (daily bars, UTC) gets one. */
export function barTicks(starts: string[], hours: number): (string | undefined)[] {
	const daily = hours === 24;
	let last = '';
	return starts.map(start => {
		const date = new Date(start);
		const key = daily ? `${date.getUTCFullYear()}-${date.getUTCMonth()}` : date.toDateString();
		if (key === last) return undefined;
		const first = last === '';
		last = key;
		if (daily) return first && date.getUTCDate() > 7 ? undefined : date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
		return first && date.getHours() >= 12 ? undefined : date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
	});
}

/** A bar's tip: "Tue, Jul 14" for a day, "Mon, Nov 16, 9 AM–noon" for a few hours (viewer's time). */
export function barDetail(start: string, hours: number) {
	const date = new Date(start);
	if (hours === 24) return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
	const end = new Date(date.getTime() + hours * 3_600_000);
	const hour = (value: Date) => value.getHours() === 12 && value.getMinutes() === 0 ? 'noon' : value.getHours() === 0 && value.getMinutes() === 0 ? 'midnight' : value.toLocaleTimeString('en-US', { hour: 'numeric', minute: value.getMinutes() ? '2-digit' : undefined });
	return `${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${hour(date)}–${hour(end)}`;
}
