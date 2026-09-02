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

export type EmissionPlacement = 'below' | 'above' | 'docked';

/** free vertical room around the trigger's row, in px; negative when content presses in. */
export interface EmissionBands {
	above: number;
	below: number;
}

export interface EmissionLayout {
	placement: EmissionPlacement;
	/** how many bubbles may show at once in this band. */
	capacity: number;
}

/** gap between the trigger's row and the first bubble, in px. */
export const EMISSION_GAP_PX = 8;
/** one bubble's height plus the gap to the next, in px. */
export const EMISSION_ROW_PX = 42;
/** how many passing comments show at once; older ones leave early when a burst exceeds it. */
export const EMISSION_STACK_MAX = 3;
/** how long one bubble lives. */
export const EMISSION_TTL_MS = 4000;
/** the page header's height; a bubble rising under it would be covered. */
export const HEADER_CLEARANCE_PX = 64;

/** bubbles that fit in a free band of `freePx`. */
export function emissionCapacity(freePx: number): number {
	return Math.max(0, Math.min(EMISSION_STACK_MAX, Math.floor((freePx - EMISSION_GAP_PX) / EMISSION_ROW_PX)));
}

export function emissionLayout(bands: EmissionBands): EmissionLayout {
	const below = emissionCapacity(bands.below);
	const above = emissionCapacity(bands.above);
	if (below === 0 && above === 0) return { placement: 'docked', capacity: 1 };
	return below >= above ? { placement: 'below', capacity: below } : { placement: 'above', capacity: above };
}

/** how far to shift a stack centered at `centerX` so it stays `margin` inside the viewport. */
export function emissionShift(centerX: number, width: number, viewportWidth: number, margin = 16): number {
	const left = centerX - width / 2;
	const right = centerX + width / 2;
	if (left < margin) return margin - left;
	if (right > viewportWidth - margin) return viewportWidth - margin - right;
	return 0;
}
