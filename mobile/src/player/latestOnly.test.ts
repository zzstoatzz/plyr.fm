import { expect, test } from "bun:test";
import { latestOnly } from "./latestOnly";

test("sends never overlap, and a burst collapses to its newest value", async () => {
  const sent: number[] = [];
  let inFlight = 0;
  let overlapped = false;
  const releases: (() => void)[] = [];
  const push = latestOnly(async (value: number) => {
    inFlight += 1;
    overlapped ||= inFlight > 1;
    sent.push(value);
    await new Promise<void>((release) => releases.push(release));
    inFlight -= 1;
  });

  push(1);
  push(2);
  push(3);
  expect(sent).toEqual([1]);
  releases.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(sent).toEqual([1, 3]);
  releases.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  push(4);
  expect(sent).toEqual([1, 3, 4]);
  expect(overlapped).toBe(false);
});

test("a failed send does not hold back the next one", async () => {
  const sent: string[] = [];
  const push = latestOnly(async (value: string) => {
    sent.push(value);
    if (value === "bad") throw new Error("rejected");
  });
  push("bad");
  await Promise.resolve();
  await Promise.resolve();
  push("good");
  expect(sent).toEqual(["bad", "good"]);
});
