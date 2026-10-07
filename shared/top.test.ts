import { expect, test } from "bun:test";
import { periodsAfter, topTracksQuery } from "./top";

test("the period toggle steps forward and wraps back to where it started", () => {
  expect(periodsAfter("month")).toEqual(["week", "day", "all_time", "month"]);
});

test("all time sends no period", () => {
  expect(topTracksQuery("all_time")).toBe("limit=10");
  expect(topTracksQuery("week")).toBe("limit=10&period=week");
});
