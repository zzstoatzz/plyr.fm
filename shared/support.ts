import type { Artist } from "./contract";

/** Where "support" goes: the artist's own link, or their atprotofans page when they chose that (frontend/src/lib/config.ts). */
export function supportUrl(artist: Pick<Artist, "did" | "support_url">): string | null {
  if (!artist.support_url) return null;
  if (artist.support_url === "atprotofans") return `https://atprotofans.com/support/${artist.did}`;
  return /^https:\/\//.test(artist.support_url) ? artist.support_url : null;
}
