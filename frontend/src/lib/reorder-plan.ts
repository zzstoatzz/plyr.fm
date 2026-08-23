/**
 * geometry for touch reordering: rows are measured once at pickup, and every
 * later decision — where the drag would land, who moves out of the way, where
 * the landing line sits — reads those measurements, never the moving DOM.
 */

export interface PlannedRow {
	/** the row's queue index (data-index), used for the actual move */
	queueIndex: number;
	top: number;
	height: number;
}

const mid = (row: PlannedRow) => row.top + row.height / 2;

/** the visual slot (0..rows.length-1) the dragged row would land in. */
export function insertionSlot(rows: PlannedRow[], draggedPos: number, fingerY: number): number {
	let below = 0;
	for (let i = 0; i < rows.length; i++) {
		if (i === draggedPos) continue;
		if (mid(rows[i]) < fingerY) below += 1;
	}
	return below;
}

/** per-row vertical shifts (px) that open the gap at `slot`, iOS-home-screen style. */
export function displacements(
	rows: PlannedRow[],
	draggedPos: number,
	slot: number,
	gap: number
): number[] {
	const dragged = rows[draggedPos];
	return rows.map((_, i) => {
		if (i === draggedPos) return 0;
		if (slot > draggedPos && i > draggedPos && i <= slot) return -(dragged.height + gap);
		if (slot < draggedPos && i >= slot && i < draggedPos) return dragged.height + gap;
		return 0;
	});
}

/** the y of the landing line, in the same coordinate space as the measurements. */
export function landingLineY(
	rows: PlannedRow[],
	draggedPos: number,
	slot: number,
	gap: number
): number {
	if (slot === draggedPos) return rows[draggedPos].top - gap / 2;
	if (slot > draggedPos) return rows[slot].top + rows[slot].height + gap / 2;
	return rows[slot].top - gap / 2;
}

/** the queue index to hand queue.moveTrack, or null for "stay put". */
export function moveTarget(rows: PlannedRow[], draggedPos: number, slot: number): number | null {
	if (slot === draggedPos) return null;
	return rows[slot].queueIndex;
}
