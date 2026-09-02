/**
 * where a passing-comment bubble can surface without being hidden.
 *
 * it hangs below the comments trigger when the space between the trigger
 * and the fixed footer player can hold it; otherwise it docks just above
 * the player, the way the comments panel does, so it is never drawn
 * underneath it or off the bottom of the viewport.
 */

export type EmissionPlacement = 'anchored' | 'docked';

/** bubble height plus its gap to the trigger, in px; generous so a two-line wrap still fits. */
export const EMISSION_SPACE_PX = 56;

export function emissionPlacement(
	anchorBottom: number,
	viewportHeight: number,
	playerHeight: number
): EmissionPlacement {
	if (anchorBottom < 0) return 'docked';
	return anchorBottom + EMISSION_SPACE_PX <= viewportHeight - playerHeight ? 'anchored' : 'docked';
}
