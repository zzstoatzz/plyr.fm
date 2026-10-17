export const FFT_SIZE = 256;

/** Floor of a bar, so a quiet passage still shows four marks. */
export const REST = 0.18;

// [first bin, end bin] per bar, left to right; at 48 kHz a bin is 187.5 Hz wide. Not in frequency order, so the bars do not read as a staircase.
const BANDS = [
  [2, 5],
  [0, 2],
  [5, 11],
  [11, 32],
] as const;

export const BARS = BANDS.length;

/** A band quieter than this is not stretched to full height. */
const PEAK_FLOOR = 0.04;
/** How much of a band's remembered peak survives a frame: it halves in about five seconds at 30 frames a second. */
const PEAK_DECAY = 0.995;
const CONTRAST = 1.6;

/**
 * Turns an analyser's byte spectrum (0-255 per bin) into one height per bar, each between REST and 1.
 * Music is far louder in the bass than the treble, so each bar is measured against its own recent peak.
 */
export function createMeter(): (spectrum: Uint8Array) => number[] {
  const peaks = BANDS.map(() => PEAK_FLOOR);
  return (spectrum) =>
    BANDS.map(([from, to], bar) => {
      let sum = 0;
      for (let bin = from; bin < to; bin++) sum += spectrum[bin] ?? 0;
      const level = sum / (to - from) / 255;
      const peak = Math.max(level, (peaks[bar] ?? PEAK_FLOOR) * PEAK_DECAY, PEAK_FLOOR);
      peaks[bar] = peak;
      return Math.max(REST, (level / peak) ** CONTRAST);
    });
}
