// tests for the shared list-reorder state machine: the pure move helper, the
// desktop drag lifecycle (incl. drop-on-self no-op and state reset), and the
// touch lifecycle with mocked row geometry for the hit-testing scan.
import { describe, it, expect, vi } from 'vitest';

import { createListReorder, moveItem } from './list-reorder.svelte';

function dragEvent(): DragEvent {
	return new Event('dragstart', { cancelable: true }) as DragEvent;
}

function touchEvent(clientY: number, target?: HTMLElement): TouchEvent {
	const event = new Event('touchstart', { cancelable: true }) as TouchEvent;
	Object.defineProperty(event, 'touches', { value: [{ clientY }] });
	if (target) {
		Object.defineProperty(event, 'currentTarget', { value: target });
	}
	return event;
}

/** a list element whose rows report fixed 50px-tall stacked rects. */
function listWithRows(count: number): { list: HTMLElement; rows: HTMLElement[] } {
	const list = document.createElement('div');
	const rows: HTMLElement[] = [];
	for (let i = 0; i < count; i++) {
		const row = document.createElement('div');
		row.className = 'track-row';
		row.dataset.index = String(i);
		row.getBoundingClientRect = () => ({ top: i * 50, height: 50, bottom: i * 50 + 50 }) as DOMRect;
		list.appendChild(row);
		rows.push(row);
	}
	return { list, rows };
}

describe('moveItem', () => {
	it('moves an element and returns a new array', () => {
		const items = ['a', 'b', 'c', 'd'];

		const moved = moveItem(items, 0, 2);

		expect(moved).toEqual(['b', 'c', 'a', 'd']);
		expect(items).toEqual(['a', 'b', 'c', 'd']);
	});

	it('returns the same array when from equals to', () => {
		const items = ['a', 'b'];

		expect(moveItem(items, 1, 1)).toBe(items);
	});
});

describe('desktop drag', () => {
	it('fires onMove with the dragged and dropped indices, then resets', () => {
		const onMove = vi.fn();
		const reorder = createListReorder(onMove);

		reorder.handleDragStart(dragEvent(), 0);
		expect(reorder.draggedIndex).toBe(0);

		reorder.handleDragOver(dragEvent(), 2);
		expect(reorder.dragOverIndex).toBe(2);

		reorder.handleDrop(dragEvent(), 2);
		expect(onMove).toHaveBeenCalledWith(0, 2);
		expect(reorder.draggedIndex).toBeNull();
		expect(reorder.dragOverIndex).toBeNull();
	});

	it('does not fire onMove when dropping on the dragged row', () => {
		const onMove = vi.fn();
		const reorder = createListReorder(onMove);

		reorder.handleDragStart(dragEvent(), 1);
		reorder.handleDrop(dragEvent(), 1);

		expect(onMove).not.toHaveBeenCalled();
		expect(reorder.draggedIndex).toBeNull();
	});

	it('resets state on dragend without firing onMove', () => {
		const onMove = vi.fn();
		const reorder = createListReorder(onMove);

		reorder.handleDragStart(dragEvent(), 0);
		reorder.handleDragOver(dragEvent(), 1);
		reorder.handleDragEnd();

		expect(onMove).not.toHaveBeenCalled();
		expect(reorder.draggedIndex).toBeNull();
		expect(reorder.dragOverIndex).toBeNull();
	});
});

describe('touch drag', () => {
	it('tracks the dragged row, hit-tests rows on move, and fires onMove on release', () => {
		const onMove = vi.fn();
		const reorder = createListReorder(onMove);
		const { list, rows } = listWithRows(3);
		reorder.listElement = list;

		reorder.handleTouchStart(touchEvent(25, rows[0]), 0);
		expect(reorder.touchDragIndex).toBe(0);
		expect(rows[0].classList.contains('touch-dragging')).toBe(true);

		// drag down past the midpoint of row 2 (midY = 125)
		reorder.handleTouchMove(touchEvent(130));
		expect(reorder.dragOverIndex).toBe(2);
		expect(rows[0].style.transform).toBe('translateY(105px)');

		reorder.handleTouchEnd();
		expect(onMove).toHaveBeenCalledWith(0, 2);
		expect(reorder.touchDragIndex).toBeNull();
		expect(rows[0].classList.contains('touch-dragging')).toBe(false);
		expect(rows[0].style.transform).toBe('');
	});

	it('does not fire onMove on a tap (release without any move)', () => {
		const onMove = vi.fn();
		const reorder = createListReorder(onMove);
		const { list, rows } = listWithRows(3);
		reorder.listElement = list;

		reorder.handleTouchStart(touchEvent(25, rows[0]), 0);
		reorder.handleTouchEnd();

		expect(onMove).not.toHaveBeenCalled();
		expect(rows[0].classList.contains('touch-dragging')).toBe(false);
	});

	// legacy quirk, preserved verbatim from the page handlers: the hit-test
	// scan marks a neighboring row as the drop target for ANY movement, even
	// one that stays within the dragged row's own bounds — so a micro-wiggle
	// reorders by one position on release.
	it('marks a neighbor as drop target even for movement within the dragged row', () => {
		const onMove = vi.fn();
		const reorder = createListReorder(onMove);
		const { list, rows } = listWithRows(3);
		reorder.listElement = list;

		reorder.handleTouchStart(touchEvent(25, rows[0]), 0);
		reorder.handleTouchMove(touchEvent(30));
		reorder.handleTouchEnd();

		expect(onMove).toHaveBeenCalledWith(0, 1);
	});

	it('ignores touch moves without an active drag or list element', () => {
		const onMove = vi.fn();
		const reorder = createListReorder(onMove);

		// no touchstart, no list element — must be a no-op
		reorder.handleTouchMove(touchEvent(100));

		expect(reorder.dragOverIndex).toBeNull();
		expect(onMove).not.toHaveBeenCalled();
	});
});
