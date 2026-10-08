import type { SearchResult } from "./contract";
import { count } from "./format";

// same wording as SearchModal.svelte's getResultTitle/getResultSubtitle; search.test.ts holds it

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

export function resultTitle(result: SearchResult): string {
  switch (result.type) {
    case "track":
    case "album":
      return result.title;
    case "artist":
      return result.display_name;
    case "tag":
    case "playlist":
      return result.name;
  }
}

export function resultSubtitle(result: SearchResult): string {
  switch (result.type) {
    case "track":
    case "album":
      return `by ${result.artist_display_name}`;
    case "artist":
      return `@${result.handle}`;
    case "tag":
      return count(result.track_count, "track");
    case "playlist":
      return `by ${result.owner_display_name} · ${count(result.track_count, "track")}`;
  }
}

export function resultImage(result: SearchResult): string | null {
  switch (result.type) {
    case "artist":
      return result.avatar_url;
    case "tag":
      return null;
    default:
      return result.image_url;
  }
}

export function resultKey(result: SearchResult): string {
  return result.type === "artist" ? `artist:${result.did}` : `${result.type}:${result.id}`;
}
