/**
 * how far a skip moves, by track length: a fixed 15 s is most of a short
 * track, so the step steps down with duration. the rule is this one ladder.
 */

export const SKIP_STEP_LADDER = [
	{ underSeconds: 60, step: 5 },
	{ underSeconds: 180, step: 10 }
] as const;

export const SKIP_STEP_MAX = 15;

/** unknown or zero duration means the track has not loaded yet; the largest step stands in. */
export function skipStepSeconds(durationSeconds: number): number {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return SKIP_STEP_MAX;
	const rung = SKIP_STEP_LADDER.find((r) => durationSeconds < r.underSeconds);
	return rung?.step ?? SKIP_STEP_MAX;
}
