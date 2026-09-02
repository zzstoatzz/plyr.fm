/**
 * where passing-comment bubbles can surface without covering anything.
 *
 * the trigger sits in a row of page content. the free band below that row
 * (down to the next content or the fixed footer player) and the free band
 * above it (up to the previous content or the header) are measured; the
 * stack goes in the larger band and is capped to how many bubbles fit
 * there. only when neither band holds a bubble does it dock at the
 * player's edge, one bubble at a time. the stack is also kept inside the
 * viewport horizontally, since its trigger may sit near an edge.
 */

export type EmissionPlacement = 'below' | 'above' | 'beside-right' | 'beside-left' | 'docked';

/** free room around the trigger, in px; negative when content presses in. above/below are
 * measured from the trigger's whole row, right/left from the trigger itself along that row. */
export interface EmissionBands {
	above: number;
	below: number;
	right: number;
	left: number;
}

export interface EmissionLayout {
	placement: EmissionPlacement;
	/** how many bubbles may show at once in this band. */
	capacity: number;
	/** the widest a bubble may be here, in px; unset where the default max applies. */
	maxWidth?: number;
}

/** the narrowest a bubble beside the trigger is worth showing at, in px. */
export const EMISSION_SIDE_MIN_PX = 160;
/** gap between the trigger and a bubble beside it, in px (the stack's css offset). */
export const EMISSION_SIDE_GAP_PX = 8;

/** gap between the trigger's row and the first bubble, in px (the stack's css offset). */
export const EMISSION_GAP_PX = 6;
/** one bubble's rendered height, in px. */
export const EMISSION_BUBBLE_PX = 36;
/** gap between stacked bubbles, in px (the stack's css gap). */
export const EMISSION_INNER_GAP_PX = 4;
/** how many passing comments show at once; older ones leave early when a burst exceeds it. */
export const EMISSION_STACK_MAX = 3;
/** how long one bubble lives. */
export const EMISSION_TTL_MS = 4000;
/** the page header's height; a bubble rising under it would be covered. */
export const HEADER_CLEARANCE_PX = 64;

/** bubbles that fit in a free band of `freePx`: the first needs the row gap, each further one the inner gap. */
export function emissionCapacity(freePx: number): number {
	const first = EMISSION_GAP_PX + EMISSION_BUBBLE_PX;
	if (freePx < first) return 0;
	const more = Math.floor((freePx - first) / (EMISSION_BUBBLE_PX + EMISSION_INNER_GAP_PX));
	return Math.min(EMISSION_STACK_MAX, 1 + more);
}

export function emissionLayout(bands: EmissionBands): EmissionLayout {
	const below = emissionCapacity(bands.below);
	const above = emissionCapacity(bands.above);
	if (below > 0 || above > 0) {
		return below >= above ? { placement: 'below', capacity: below } : { placement: 'above', capacity: above };
	}
	const right = bands.right - EMISSION_SIDE_GAP_PX;
	const left = bands.left - EMISSION_SIDE_GAP_PX;
	if (right >= EMISSION_SIDE_MIN_PX || left >= EMISSION_SIDE_MIN_PX) {
		return right >= left
			? { placement: 'beside-right', capacity: 1, maxWidth: right }
			: { placement: 'beside-left', capacity: 1, maxWidth: left };
	}
	return { placement: 'docked', capacity: 1 };
}

/** a horizontal span something else already occupies, in viewport px. */
export interface EmissionObstacle {
	left: number;
	right: number;
}

/**
 * how far to shift a stack spanning [left, right] so it stays `margin` inside
 * the viewport and clear of anything fixed over its ends (the queue toggle,
 * say). obstacles win over centering; the viewport edge wins over obstacles.
 */
export function emissionShift(
	left: number,
	right: number,
	viewportWidth: number,
	obstacles: EmissionObstacle[] = [],
	margin = 16
): number {
	let shift = 0;
	for (const o of obstacles) {
		const overlapsRight = o.left < right + shift && o.right > left + shift && o.left > left + shift;
		const overlapsLeft = o.right > left + shift && o.left < right + shift && !overlapsRight;
		if (overlapsRight) shift += o.left - margin - (right + shift);
		else if (overlapsLeft) shift += o.right + margin - (left + shift);
	}
	if (left + shift < margin) shift = margin - left;
	if (right + shift > viewportWidth - margin) shift = viewportWidth - margin - right;
	return shift;
}

/** the stack's tallest allowed height for `capacity` bubbles, in px; evicted bubbles fade inside it. */
export function emissionStackHeight(capacity: number): number {
	return capacity * EMISSION_BUBBLE_PX + Math.max(0, capacity - 1) * EMISSION_INNER_GAP_PX;
}
