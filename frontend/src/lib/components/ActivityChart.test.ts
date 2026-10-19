import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ActivityChart from './ActivityChart.svelte';
import type { ActivityHistogramResponse } from '$lib/types';

let component: ReturnType<typeof mount> | undefined;
const fetcher = vi.fn<typeof fetch>();
const data: ActivityHistogramResponse = {
	interval: 'hour',
	buckets: [
		{ date: '2026-10-18T23:00:00+00:00', count: 3 },
		{ date: '2026-10-19T00:00:00+00:00', count: 0 },
		{ date: '2026-10-19T01:00:00+00:00', count: 7 }
	]
};

beforeEach(() => {
	fetcher.mockReset().mockImplementation(async () => Response.json(data));
	vi.stubGlobal('fetch', fetcher);
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

async function render(): Promise<void> {
	component = mount(ActivityChart, { target: document.body });
	flushSync();
	await vi.waitFor(() =>
		expect(document.querySelector('section')?.getAttribute('aria-busy')).toBe('false')
	);
}

function click(label: string): void {
	const button = [...document.querySelectorAll('button')].find(
		(item) => item.textContent === label
	);
	if (!button) throw new Error(`missing button: ${label}`);
	button.click();
	flushSync();
}

it('shows period totals, inspects a zero bucket, and restores the total on blur', async () => {
	await render();
	expect(document.querySelector('strong')?.textContent).toBe('10');
	const slider = document.querySelector('input');
	if (!slider) throw new Error('missing chart slider');
	slider.focus();
	slider.value = '1';
	slider.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	expect(document.querySelector('strong')?.textContent).toBe('0');
	expect(slider.getAttribute('aria-valuetext')).toContain('UTC: 0 events');
	expect(document.querySelector('.readout-date')?.textContent).toContain('Oct 19');
	slider.blur();
	flushSync();
	expect(document.querySelector('strong')?.textContent).toBe('10');
});

it('requests each named range and prevents a late response replacing the selection', async () => {
	await render();
	let resolveDay: (value: Response) => void = () => {};
	fetcher.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveDay = resolve;
			})
	);
	click('day');
	const signal = fetcher.mock.calls.at(-1)?.[1]?.signal;
	fetcher.mockImplementation(async () =>
		Response.json({ ...data, buckets: [{ ...data.buckets[0], count: 42 }] })
	);
	for (const range of ['month', 'year', 'all']) {
		click(range);
		await vi.waitFor(() => expect(document.querySelector('strong')?.textContent).toBe('42'));
		expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain(`range=${range}`);
	}
	expect(signal?.aborted).toBe(true);
	resolveDay(Response.json(data));
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
	expect(document.querySelector('strong')?.textContent).toBe('42');
});

it('keeps empty periods visible and recovers from a failed request', async () => {
	fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
	await render();
	expect(document.body.textContent).toContain('activity couldn’t load');
	fetcher.mockImplementation(async () =>
		Response.json({
			interval: 'month',
			buckets: [{ date: '2026-10-01T00:00:00Z', count: 0 }]
		} satisfies ActivityHistogramResponse)
	);
	click('try again');
	await vi.waitFor(() => expect(document.body.textContent).toContain('no activity in this period'));
	expect(document.querySelector('input')?.getAttribute('aria-valuetext')).toContain('October 2026');
	expect(document.querySelector('svg')?.innerHTML).not.toMatch(/NaN|Infinity/);
});
