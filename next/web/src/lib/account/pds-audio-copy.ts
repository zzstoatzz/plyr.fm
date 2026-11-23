import type { AudioGap } from '@plyr/next-core/publishing/pds-audio-gaps';
import type { RowState } from './pds-audio.svelte';

export function offerCopy(count: number) {
  return count === 1
    ? { title: "one of your tracks isn't on your PDS", detail: 'plyr.fm can put it there now. it keeps playing the whole time.' }
    : { title: `${count} of your tracks aren't on your PDS`, detail: 'plyr.fm can put them there now. they keep playing the whole time.' };
}

export function resultCopy(gaps: AudioGap[], rows: Record<string, { state: RowState }>) {
  const fixable = gaps.filter(gap => !gap.tooBig);
  const count = (state: RowState) => fixable.filter(gap => rows[gap.uri]?.state === state).length;
  const moved = count('moved'), tooBig = count('too-big'), noCopy = count('no-copy'), failed = count('failed');
  const stuck = fixable.length - moved;
  const tracks = (n: number) => n === 1 ? '1 track' : `${n} tracks`;
  if (!stuck) return { allMoved: true, retry: false, title: "everything's on your PDS now", detail: `${tracks(moved)} moved.` };
  const title = moved ? `${moved} moved, ${stuck} couldn't` : stuck === 1 ? "this one couldn't move" : `these ${stuck} couldn't move`;
  const detail = [
    tooBig && "your PDS won't take files over 100 MB, so plyr.fm keeps those. they play the same either way.",
    noCopy && "plyr.fm has no copy of what your PDS lost. replacing the audio fixes it.",
    failed && 'something went wrong partway. trying again picks up where it stopped.'
  ].filter(Boolean).join(' ');
  return { allMoved: false, retry: failed > 0, title, detail };
}
