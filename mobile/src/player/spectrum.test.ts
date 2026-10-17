import { expect, test } from "bun:test";
import { BARS, createMeter, FFT_SIZE, REST } from "./spectrum";

const bins = (fill: (bin: number) => number) => Uint8Array.from({ length: FFT_SIZE / 2 }, (_, bin) => fill(bin));

test("silence rests every bar at the floor", () => {
  expect(createMeter()(bins(() => 0))).toEqual(Array.from({ length: BARS }, () => REST));
});

test("a band at its own peak fills its bar, however quiet it is next to the bass", () => {
  const levels = createMeter()(bins((bin) => (bin < 2 ? 250 : 40)));
  expect(levels).toEqual(Array.from({ length: BARS }, () => 1));
});

test("a bar falls as its band drops below the peak it just had", () => {
  const meter = createMeter();
  meter(bins(() => 200));
  const [, bass] = meter(bins((bin) => (bin < 2 ? 100 : 200)));
  expect(bass).toBeGreaterThan(REST);
  expect(bass).toBeLessThan(0.5);
});

test("a remembered peak fades, so a track that turns quiet fills the bars again", () => {
  const meter = createMeter();
  meter(bins(() => 250));
  const quiet = bins(() => 60);
  const first = meter(quiet)[0] ?? 0;
  let later = first;
  for (let frame = 0; frame < 600; frame++) later = meter(quiet)[0] ?? 0;
  expect(later).toBeGreaterThan(first);
  expect(later).toBe(1);
});
