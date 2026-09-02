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

/** bubble height plus its gap to the trigger, in px; generous so a two-line wrap still fits. */
export const EMISSION_SPACE_PX = 56;

/** the page header's height; a bubble rising under it would be covered. */
export const HEADER_CLEARANCE_PX = 64;

export function emissionPlacement(
	anchorTop: number,
	anchorBottom: number,
	viewportHeight: number,
	playerHeight: number
): EmissionPlacement {
	if (anchorBottom < 0) return 'docked';
	if (anchorBottom + EMISSION_SPACE_PX <= viewportHeight - playerHeight) return 'below';
	if (anchorTop - EMISSION_SPACE_PX >= HEADER_CLEARANCE_PX) return 'above';
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
