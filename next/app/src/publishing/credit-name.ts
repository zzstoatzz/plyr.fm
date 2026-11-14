/** Characters that take up space or nothing at all but show no mark: zero-width marks, the braille blank, Hangul fillers and the like. */
const BLANK = /[\s­͏ᅟᅠ឴឵᠎​‎‏‪-‮⁠-⁯⠀ㅤ︀-️﻿ﾠ]+/gu;
/** Joiners shape emoji and scripts, so they stay inside a name, but alone they show nothing. */
const JOINERS = /[‌‍]/gu;

/** A profile name a track can be credited to, or undefined when it shows nothing readable. */
export function creditName(name: string | null | undefined): string | undefined {
  const visible = name?.replace(BLANK, ' ').trim();
  return visible?.replace(JOINERS, '').trim() ? visible : undefined;
}
