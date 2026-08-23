import { describe, it, expect } from 'vitest';
import { displacements, insertionSlot, landingLineY, moveTarget, type PlannedRow } from './reorder-plan';

const GAP = 8;
const rows: PlannedRow[] = [0, 1, 2, 3].map((i) => ({
	queueIndex: i + 10,
	top: 100 + i * 72,
	height: 64
}));

describe('reorder plan', () => {
	it('finds the slot from the finger against the captured midpoints', () => {
		expect(insertionSlot(rows, 0, 100)).toBe(0);
		expect(insertionSlot(rows, 0, 260)).toBe(1);
		expect(insertionSlot(rows, 0, 300)).toBe(2);
		expect(insertionSlot(rows, 3, 110)).toBe(0);
	});

	it('rows between the origin and the slot move out of the way', () => {
		// dragging row 0 down past rows 1 and 2: they shift up
		expect(displacements(rows, 0, 2, GAP)).toEqual([0, -72, -72, 0]);
		// dragging row 3 up to the top: rows 0..2 shift down
		expect(displacements(rows, 3, 0, GAP)).toEqual([72, 72, 72, 0]);
		// staying put moves nobody
		expect(displacements(rows, 1, 1, GAP)).toEqual([0, 0, 0, 0]);
	});

	it('the landing line sits at the gap the rows opened', () => {
		expect(landingLineY(rows, 0, 2, GAP)).toBe(100 + 2 * 72 + 64 + 4);
		expect(landingLineY(rows, 3, 0, GAP)).toBe(100 - 4);
		expect(landingLineY(rows, 1, 1, GAP)).toBe(100 + 72 - 4);
	});

	it('the move target is the occupied slot, or null when staying put', () => {
		expect(moveTarget(rows, 0, 2)).toBe(12);
		expect(moveTarget(rows, 3, 0)).toBe(10);
		expect(moveTarget(rows, 1, 1)).toBeNull();
	});
});
