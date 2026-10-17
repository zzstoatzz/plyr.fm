import { expect, test } from "bun:test";
import { extended, FADE_MS, sleepChoice, sleepIn, sleepRemaining, sleepVolume } from "./sleep";

const now = 1_000_000;

test("volume is full until the fade, then falls to silence at the end", () => {
  const sleep = sleepIn(15, now);
  if (sleep.kind !== "at") throw new Error("timed");
  expect(sleepVolume(sleep, now)).toBe(1);
  expect(sleepVolume(sleep, sleep.endsAt - FADE_MS)).toBe(1);
  expect(sleepVolume(sleep, sleep.endsAt - FADE_MS / 2)).toBe(0.5);
  expect(sleepVolume(sleep, sleep.endsAt)).toBe(0);
  expect(sleepVolume(sleep, sleep.endsAt + 5000)).toBe(0);
});

test("waiting for the track to end never fades", () => {
  expect(sleepVolume({ kind: "track" }, now)).toBe(1);
});

test("more time moves the end and keeps the start, so progress does not jump back", () => {
  const sleep = sleepIn(15, now);
  expect(extended(sleep, 10, now + 60_000)).toEqual({ kind: "at", startedAt: now, endsAt: now + 25 * 60_000 });
});

test("more time on an end-of-track timer makes it a timed one from now", () => {
  expect(extended({ kind: "track" }, 10, now)).toEqual(sleepIn(10, now));
});

test("remaining time rounds up and never reads zero", () => {
  const sleep = sleepIn(15, now);
  expect(sleepRemaining(sleep, now)).toBe("15 min left");
  expect(sleepRemaining(sleep, now + 14 * 60_000 + 1)).toBe("1 min left");
  expect(sleepRemaining(sleep, now + 15 * 60_000)).toBe("1 min left");
  expect(sleepRemaining({ kind: "track" }, now)).toBe("until this track ends");
});

test("choices read as the menu shows them", () => {
  expect([15, 60].map(sleepChoice)).toEqual(["15 minutes", "1 hour"]);
});
