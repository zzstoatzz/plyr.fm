import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TagInput from './TagInput.svelte';
import HandleAutocomplete from './HandleAutocomplete.svelte';
import HandleSearch from './HandleSearch.svelte';
import AlbumSelect from './AlbumSelect.svelte';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
	for (const dispose of cleanup.splice(0)) await dispose();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

function inputText(value: string): HTMLInputElement {
	const input = document.querySelector('input');
	if (!input) throw new Error('input not rendered');
	input.focus();
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	return input;
}

function pressEscape(input: HTMLInputElement): KeyboardEvent {
	const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	input.dispatchEvent(event);
	flushSync();
	return event;
}

function mountTags(onAdd: (tag: string) => void) {
	const component = mount(TagInput, {
		target: document.body,
		props: { tags: [], onAdd, onRemove: () => {} }
	});
	cleanup.push(() => unmount(component));
	flushSync();
}

async function showTagSuggestions() {
	vi.useFakeTimers();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json([{ name: 'ambient', track_count: 4 }]))
	);
	const input = inputText('amb');
	await vi.advanceTimersByTimeAsync(200);
	flushSync();
	return input;
}

describe('autocomplete interactions inside a dialog', () => {
	it('commits pending tag text before the next button click', () => {
		vi.useFakeTimers();
		const added: string[] = [];
		mountTags((tag) => added.push(tag));
		const input = inputText('ambient');
		const save = document.createElement('button');
		const saveTags = vi.fn(() => [...added]);
		save.onclick = saveTags;
		document.body.append(save);
		save.focus();
		save.click();
		flushSync();
		expect(input.value).toBe('');
		expect(saveTags).toHaveReturnedWith(['ambient']);
	});

	it('preserves focus during suggestion selection without committing the partial tag', async () => {
		const onAdd = vi.fn();
		mountTags(onAdd);
		const input = await showTagSuggestions();
		const suggestion = document.querySelector<HTMLButtonElement>('.suggestion-item');
		if (!suggestion) throw new Error('suggestion not rendered');
		const pointerdown = new Event('pointerdown', { bubbles: true, cancelable: true });
		suggestion.dispatchEvent(pointerdown);
		expect(pointerdown.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(input);
		suggestion.click();
		expect(onAdd).toHaveBeenCalledExactlyOnceWith('ambient');
	});

	it('consumes Escape only while tag suggestions are open', async () => {
		mountTags(() => {});
		const input = await showTagSuggestions();
		expect(pressEscape(input).defaultPrevented).toBe(true);
		expect(document.querySelector('.suggestion-item')).toBeNull();
		expect(pressEscape(input).defaultPrevented).toBe(false);
	});

	it('consumes Escape only while handle suggestions are open', async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					actors: [{ did: 'did:plc:test', handle: 'artist.test', displayName: 'artist' }]
				})
			)
		);
		const component = mount(HandleAutocomplete, {
			target: document.body,
			props: { value: '', onSelect: () => {} }
		});
		cleanup.push(() => unmount(component));
		flushSync();
		const input = inputText('artist');
		await vi.advanceTimersByTimeAsync(300);
		flushSync();
		expect(document.querySelector('.result-item')).not.toBeNull();
		expect(pressEscape(input).defaultPrevented).toBe(true);
		expect(document.querySelector('.result-item')).toBeNull();
		expect(pressEscape(input).defaultPrevented).toBe(false);
	});
	it('consumes Escape only while featured-artist suggestions are open', async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				Response.json({
					actors: [{ did: 'did:plc:test', handle: 'artist.test', displayName: 'artist' }]
				})
			)
		);
		const component = mount(HandleSearch, {
			target: document.body,
			props: { selected: [], onAdd: () => {}, onRemove: () => {} }
		});
		cleanup.push(() => unmount(component));
		flushSync();
		const input = inputText('artist');
		await vi.advanceTimersByTimeAsync(300);
		flushSync();
		expect(document.querySelector('.search-result-item')).not.toBeNull();
		expect(pressEscape(input).defaultPrevented).toBe(true);
		expect(document.querySelector('.search-result-item')).toBeNull();
		expect(pressEscape(input).defaultPrevented).toBe(false);
	});

	it('consumes Escape only while album suggestions are open', () => {
		const component = mount(AlbumSelect, {
			target: document.body,
			props: {
				value: '',
				albums: [{ id: 'album-1', title: 'album', slug: 'album', track_count: 2, total_plays: 0 }]
			}
		});
		cleanup.push(() => unmount(component));
		flushSync();
		const input = inputText('alb');
		expect(document.querySelector('.album-result-item')).not.toBeNull();
		expect(pressEscape(input).defaultPrevented).toBe(true);
		expect(document.querySelector('.album-result-item')).toBeNull();
		expect(pressEscape(input).defaultPrevented).toBe(false);
	});

	it('associates visible labels with each editor autocomplete input', () => {
		const tags = mount(TagInput, {
			target: document.body,
			props: { id: 'edit-tags', tags: [], onAdd: () => {}, onRemove: () => {} }
		});
		const album = mount(AlbumSelect, {
			target: document.body,
			props: { id: 'edit-album', albums: [], value: '' }
		});
		const features = mount(HandleSearch, {
			target: document.body,
			props: { id: 'edit-features', selected: [], onAdd: () => {}, onRemove: () => {} }
		});
		cleanup.push(
			() => unmount(tags),
			() => unmount(album),
			() => unmount(features)
		);
		flushSync();
		for (const id of ['edit-tags', 'edit-album', 'edit-features']) {
			const label = document.createElement('label');
			label.htmlFor = id;
			label.textContent = id;
			document.body.append(label);
			const input = document.getElementById(id);
			expect(input).toBeInstanceOf(HTMLInputElement);
			expect(label.control).toBe(input);
			expect(input?.hasAttribute('aria-label')).toBe(false);
		}
	});
});
