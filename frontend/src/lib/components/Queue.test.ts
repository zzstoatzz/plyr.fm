import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Queue from '$lib/components/Queue.svelte';
import { queue } from '$lib/queue.svelte';
import type { Track } from '$lib/types';

const TRACK: Track = {
	id: 1,
	title: 'only one',
	artist: 'someone',
	artist_did: 'did:plc:a',
	artist_handle: 'someone.test',
	file_id: 'f1',
	file_type: 'mp3',
	play_count: 0,
	like_count: 0,
	created_at: '2026-01-01T00:00:00Z'
};

let component: object | null = null;

afterEach(() => {
	if (component) unmount(component);
	component = null;
	queue.clear();
	document.body.innerHTML = '';
});

describe('Queue empty-state cta', () => {
	it('tells its host it is navigating, so a full-screen queue can close', () => {
		queue.tracks = [TRACK];
		queue.currentIndex = 0;
		const onNavigate = vi.fn();
		component = mount(Queue, { target: document.body, props: { onNavigate } });
		flushSync();

		const cta = document.querySelector('a.empty-cta');
		if (!(cta instanceof HTMLAnchorElement)) throw new Error('cta not rendered');
		expect(cta.textContent?.trim()).toBe('find something to play');
		cta.addEventListener('click', (e) => e.preventDefault());
		cta.click();
		expect(onNavigate).toHaveBeenCalledTimes(1);
	});
});


function makeTrack(id: number): Track {
	return { ...TRACK, id, title: `t${id}`, file_id: `f${id}` };
}

function focusRow(position: number): HTMLElement {
	const rows = [...document.querySelectorAll<HTMLElement>('.queue-track')];
	const row = rows[position];
	if (!row) throw new Error(`no queue row at ${position}`);
	row.focus();
	return row;
}

function press(el: HTMLElement, key: string) {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('Queue keyboard', () => {
	it('delete removes the focused row and keeps focus in the list', async () => {
		queue.tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
		queue.currentIndex = 0;
		component = mount(Queue, { target: document.body, props: {} });
		flushSync();

		expect(document.querySelectorAll('.queue-track').length).toBe(2);
		press(focusRow(0), 'Delete');
		flushSync();
		await Promise.resolve();
		expect(queue.tracks.map((t) => t.id)).toEqual([1, 3]);
	});

	it('arrows move focus between rows', () => {
		queue.tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
		queue.currentIndex = 0;
		component = mount(Queue, { target: document.body, props: {} });
		flushSync();

		const first = focusRow(0);
		press(first, 'ArrowDown');
		const rows = [...document.querySelectorAll<HTMLElement>('.queue-track')];
		expect(document.activeElement).toBe(rows[1]);
		press(rows[1], 'ArrowUp');
		expect(document.activeElement).toBe(rows[0]);
	});

});
