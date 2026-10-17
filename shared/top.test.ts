import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chartSections, periodsAfter, TOP_CHART_LIMIT, topTracksQuery } from "./top";

test("the period toggle steps forward and wraps back to where it started", () => {
  expect(periodsAfter("month")).toEqual(["week", "day", "all_time", "month"]);
});

test("all time sends no period", () => {
  expect(topTracksQuery("all_time")).toBe("limit=10");
  expect(topTracksQuery("week")).toBe("limit=10&period=week");
});

test("a longer chart continues a shorter one without repeating it", () => {
  const track = (id: number) => ({ id });
  const sections = chartSections([
    { title: "week", tracks: [track(1), track(2)] },
    { title: "month", tracks: [track(2), track(1)] },
    { title: "all", tracks: [track(3), track(1), track(4)] },
  ]);
  expect(sections).toEqual([
    { title: "week", tracks: [track(1), track(2)] },
    { title: "all", tracks: [track(3), track(4)] },
  ]);
});

test("the chart limit is the API's ceiling", () => {
  const api = readFileSync(new URL("../backend/src/backend/api/tracks/listing.py", import.meta.url), "utf8");
  const top = api.slice(api.indexOf("async def list_top_tracks"));
  expect(Number(/limit = max\(1, min\(limit, (\d+)\)\)/.exec(top)?.[1])).toBe(TOP_CHART_LIMIT);
});
