/**
 * where a passing-comment bubble can surface without covering anything.
 *
 * it hangs below the comments trigger when the band between the trigger
 * and the fixed footer player can hold it; otherwise it rises above the
 * trigger's row into the space there; only when neither band exists does
 * it dock at the player's edge. the bubble is also kept inside the
 * viewport horizontally, since its trigger may sit near an edge.
 */

export type EmissionPlacement = 'below' | 'above' | 'docked';

/** one bubble's height plus its gap to the trigger, in px; generous so a two-line wrap still fits. */
export const EMISSION_SPACE_PX = 56;
/** each further bubble in a stack, in px. */
export const EMISSION_ROW_PX = 40;
/** how many passing comments show at once; older ones leave early when a burst exceeds it. */
export const EMISSION_STACK_MAX = 3;
/** how long one bubble lives. */
export const EMISSION_TTL_MS = 4000;

/** the vertical room a full stack needs. */
export const EMISSION_STACK_PX = EMISSION_SPACE_PX + (EMISSION_STACK_MAX - 1) * EMISSION_ROW_PX;

/** the page header's height; a bubble rising under it would be covered. */
export const HEADER_CLEARANCE_PX = 64;

export function emissionPlacement(
	anchorTop: number,
	anchorBottom: number,
	viewportHeight: number,
	playerHeight: number,
	needed = EMISSION_STACK_PX
): EmissionPlacement {
	if (anchorBottom < 0) return 'docked';
	if (anchorBottom + needed <= viewportHeight - playerHeight) return 'below';
	if (anchorTop - needed >= HEADER_CLEARANCE_PX) return 'above';
	return 'docked';
}

/** how far to shift a bubble centered at `centerX` so it stays `margin` inside the viewport. */
export function emissionShift(centerX: number, width: number, viewportWidth: number, margin = 16): number {
	const left = centerX - width / 2;
	const right = centerX + width / 2;
	if (left < margin) return margin - left;
	if (right > viewportWidth - margin) return viewportWidth - margin - right;
	return 0;
}
