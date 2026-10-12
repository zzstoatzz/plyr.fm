import { expect, test } from "bun:test";
import { credited, credits } from "./format";

const solo = { artist: "A", artist_handle: "a.test", features: [] };
const featuring = {
  artist: "A",
  artist_handle: "a.test",
  features: [
    { display_name: "B", handle: "b.test" },
    { display_name: "C", handle: "c.test" },
  ],
};

test("a track's credits name the artist, then anyone featured", () => {
  expect(credits(solo)).toBe("A");
  expect(credits(featuring)).toBe("A, B, C");
});

test("each credited person carries their own handle, in the order they are named", () => {
  expect(credited(solo)).toEqual([{ name: "A", handle: "a.test" }]);
  expect(credited(featuring)).toEqual([
    { name: "A", handle: "a.test" },
    { name: "B", handle: "b.test" },
    { name: "C", handle: "c.test" },
  ]);
  expect(credited(featuring).map((person) => person.name).join(", ")).toBe(credits(featuring));
});
