import { describe, expect, test } from "bun:test";
import { decodes, streams } from "./formats";

describe("formats", () => {
  test("only the formats the bundled FFmpeg can demux are handed over as a URL", () => {
    for (const format of ["mp3", "m4a", "MP3", ".m4a"]) expect(streams(format)).toBe(true);
    for (const format of ["wav", "flac", "ogg", "opus"]) expect(streams(format)).toBe(false);
  });

  test("a format that does not stream still plays, downloaded first", () => {
    for (const format of ["wav", "flac", "ogg", "opus"]) expect(decodes(format)).toBe(true);
  });

  test("a format neither decoder opens is not offered as playable", () => {
    for (const format of ["aiff", "aif", "aac", "wma"]) expect(decodes(format)).toBe(false);
  });
});
