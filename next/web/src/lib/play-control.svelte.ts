import { playState, pressPlay, type PlayContext, type PlayerNow, type PlayState } from '@plyr/next-core/play-context';
import { player } from './player.svelte';

function now(): PlayerNow {
	return {
		current: player.current,
		station: player.liveStation?.slug,
		inJam: !!player.jam,
		playing: player.liveStation ? player.liveListening : player.playing && !player.outputElsewhere,
		starting: player.loading || player.snapshot.waiting
	};
}

/** Where this context stands in the player. Read it inside `$derived` or markup so it follows playback. */
export function contextState(context: PlayContext): PlayState {
	return playState(context, now());
}

/** Every play affordance goes through here: the context on air pauses or resumes, anything else starts. */
export function pressContext(context: PlayContext, start: () => void) {
	pressPlay(contextState(context), { toggle: () => player.toggle(), start });
}
