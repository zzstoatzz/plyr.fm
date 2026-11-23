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

const utc = (day: string) => new Date(`${day}T12:00:00Z`);

/** A bar's axis label: "Nov 13" for a day, "Nov '25" for a month. */
export function bucketLabel(day: string, bucket: 'day' | 'month') {
	const date = utc(day);
	if (bucket === 'day') return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
	return `${date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} '${String(date.getUTCFullYear()).slice(2)}`;
}

/** A bar's tip: "Thu, Nov 13" for a day, "November 2025" for a month. */
export function bucketDetail(day: string, bucket: 'day' | 'month') {
	const date = utc(day);
	return bucket === 'day'
		? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
		: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
