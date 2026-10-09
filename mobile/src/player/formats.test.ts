import { describe, expect, test } from "bun:test";
import { decodes, fetchesAhead, streams, totalBytes } from "./formats";

const MB = 1024 * 1024;

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

  test("the next track is fetched ahead unless it is a long mix that can stream instead", () => {
    expect(fetchesAhead("mp3", 8 * MB)).toBe(true);
    expect(fetchesAhead("mp3", 78 * MB)).toBe(false);
    expect(fetchesAhead("wav", 78 * MB)).toBe(true);
    expect(fetchesAhead("wav", 400 * MB)).toBe(false);
  });

  test("the size comes from the total in Content-Range", () => {
    expect(totalBytes("bytes 0-0/37632044")).toBe(37632044);
    expect(totalBytes("bytes 0-0/*")).toBeNull();
    expect(totalBytes(null)).toBeNull();
  });
});
