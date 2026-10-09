import { describe, expect, test } from "bun:test";
import * as web from "../frontend/src/lib/utils/display-image";
import * as webCover from "../frontend/src/lib/track-cover";
import { IMAGE_WIDTHS, resizedImageUrl, trackCoverUrl, trackThumbnailUrl } from "./images";

const urls = [
  "https://images.plyr.fm/images/abc123.jpeg",
  "https://images-stg.plyr.fm/xyz.png",
  "https://images.plyr.fm/images/abc.jpeg?v=2",
  "https://images.plyr.fm/cdn-cgi/image/width=640,quality=82,format=auto/images/abc.jpeg",
  "https://cdn.bsky.app/img/avatar/plain/did:plc:x/bafkrei@jpeg",
  "https://pub-308b.r2.dev/abc.jpg",
  "not a url",
  null,
  undefined,
];

describe("images match the web app", () => {
  test("widths", () => expect(IMAGE_WIDTHS).toEqual(web.IMAGE_WIDTHS));

  for (const url of urls) {
    test(`resize ${url}`, () => {
      for (const width of Object.values(IMAGE_WIDTHS)) expect(resizedImageUrl(url, width)).toBe(web.resizedImageUrl(url, width));
    });
  }

  const art = "https://images.plyr.fm/a.jpg";
  const thumb = "https://images.plyr.fm/a-thumb.jpg";
  const covers = [
    { image_url: art, thumbnail_url: thumb, artist_avatar_url: null, album: null },
    { image_url: art, artist_avatar_url: null, album: null },
    { image_url: null, artist_avatar_url: "avatar", album: { image_url: art, thumbnail_url: thumb } },
    { image_url: null, artist_avatar_url: "avatar", album: { image_url: null } },
    { image_url: null, artist_avatar_url: null, album: null },
  ];
  for (const [i, track] of covers.entries()) {
    test(`cover fallbacks ${i}`, () => {
      const asWeb = track as unknown as Parameters<typeof webCover.trackCoverUrl>[0];
      expect(trackCoverUrl(track)).toBe(webCover.trackCoverUrl(asWeb) ?? null);
      expect(trackThumbnailUrl(track)).toBe(webCover.trackThumbnailUrl(asWeb) ?? null);
    });
  }
});
