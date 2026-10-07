import { z } from "zod";

// fields mirror docs/internal/contracts/client-api.json; contract.test.ts holds this

const nullableString = z.string().nullable();

export const AlbumSummary = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  image_url: nullableString,
  thumbnail_url: nullableString.optional(),
});

export const FeaturedArtist = z.object({
  did: z.string(),
  handle: z.string(),
  display_name: z.string(),
  avatar_url: nullableString.optional(),
});

export const Track = z.object({
  id: z.number().int(),
  title: z.string(),
  artist: z.string(),
  artist_handle: z.string(),
  artist_did: z.string(),
  artist_avatar_url: nullableString,
  file_id: z.string(),
  file_type: z.string(),
  features: z.array(FeaturedArtist).default([]),
  play_count: z.number().int(),
  like_count: z.number().int(),
  created_at: z.string(),
  image_url: nullableString,
  thumbnail_url: nullableString.optional(),
  album: AlbumSummary.nullable(),
  gated: z.boolean().default(false),
  publishing: z.object({ access: z.object({ listening: z.string() }) }).optional(),
  original_file_id: nullableString.optional(),
  original_file_type: nullableString.optional(),
  is_optimizing: z.boolean().optional(),
});
export type Track = z.infer<typeof Track>;

export const AudioUrl = z.object({
  url: z.string(),
  file_id: z.string(),
  file_type: nullableString,
});
export type AudioUrl = z.infer<typeof AudioUrl>;

export const TrackSearchResult = z.object({
  type: z.literal("track"),
  id: z.number().int(),
  title: z.string(),
  artist_handle: z.string(),
  artist_display_name: z.string(),
  image_url: nullableString,
});
export type TrackSearchResult = z.infer<typeof TrackSearchResult>;

/** A JSON body as decoded off the wire, before a schema accepts it. */
export type Body = unknown;

/** One bad record is dropped and reported, so it cannot blank a whole list. */
function acceptEach<T>(schema: z.ZodType<T>, items: unknown, onReject?: (error: z.ZodError) => void): T[] {
  if (!Array.isArray(items)) throw new Error("expected a list");
  const accepted: T[] = [];
  for (const item of items) {
    const result = schema.safeParse(item);
    if (result.success) accepted.push(result.data);
    else onReject?.(result.error);
  }
  return accepted;
}

export type TrackPage = { tracks: Track[]; nextCursor: string | null; hasMore: boolean };

/** `GET /tracks/` — the discovery feed, newest first, cursor paged. */
export function parseTrackPage(body: Body, onReject?: (error: z.ZodError) => void): TrackPage {
  const page = z
    .object({
      tracks: z.array(z.unknown()),
      next_cursor: nullableString.optional(),
      has_more: z.boolean().default(false),
    })
    .parse(body);
  return {
    tracks: acceptEach(Track, page.tracks, onReject),
    nextCursor: page.next_cursor ?? null,
    hasMore: page.has_more,
  };
}

/** `GET /tracks/top` — a bare list. */
export function parseTrackList(body: Body, onReject?: (error: z.ZodError) => void): Track[] {
  return acceptEach(Track, body, onReject);
}

/** `GET /tracks/{id}`. */
export function parseTrack(body: Body): Track {
  return Track.parse(body);
}

/** `GET /audio/{file_id}/url`. */
export function parseAudioUrl(body: Body): AudioUrl {
  return AudioUrl.parse(body);
}

/** `GET /search/?type=tracks` — other result kinds are ignored, not rejected. */
export function parseTrackSearch(body: Body, onReject?: (error: z.ZodError) => void): TrackSearchResult[] {
  const { results } = z.object({ results: z.array(z.unknown()) }).parse(body);
  const tracks = results.filter((r) => typeof r === "object" && r !== null && "type" in r && r.type === "track");
  return acceptEach(TrackSearchResult, tracks, onReject);
}
