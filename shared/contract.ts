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
  tags: z.array(z.string()).default([]),
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

export const ArtistSearchResult = z.object({
  type: z.literal("artist"),
  did: z.string(),
  handle: z.string(),
  display_name: z.string(),
  avatar_url: nullableString,
});

export const AlbumSearchResult = z.object({
  type: z.literal("album"),
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  artist_handle: z.string(),
  artist_display_name: z.string(),
  image_url: nullableString,
});

export const TagSearchResult = z.object({
  type: z.literal("tag"),
  id: z.number().int(),
  name: z.string(),
  track_count: z.number().int(),
});

export const PlaylistSearchResult = z.object({
  type: z.literal("playlist"),
  id: z.string(),
  name: z.string(),
  owner_handle: z.string(),
  owner_display_name: z.string(),
  image_url: nullableString,
  track_count: z.number().int(),
});

export const SearchResult = z.discriminatedUnion("type", [
  TrackSearchResult,
  ArtistSearchResult,
  AlbumSearchResult,
  TagSearchResult,
  PlaylistSearchResult,
]);
export type SearchResult = z.infer<typeof SearchResult>;

export const Artist = z.object({
  did: z.string(),
  handle: z.string(),
  display_name: z.string(),
  bio: nullableString,
  avatar_url: nullableString,
  support_url: nullableString.optional(),
});
export type Artist = z.infer<typeof Artist>;

export const TagWithCount = z.object({
  name: z.string(),
  track_count: z.number().int(),
  total_plays: z.number().int(),
});
export type TagWithCount = z.infer<typeof TagWithCount>;

export const TagDetail = z.object({ name: z.string(), track_count: z.number().int() });

export const Playlist = z.object({
  id: z.string(),
  name: z.string(),
  owner_handle: z.string(),
  track_count: z.number().int(),
  image_url: nullableString,
});
export type Playlist = z.infer<typeof Playlist>;

/** A playlist as lists show it; `GET /lists/playlists/by-artist/{did}` serves these. */
export const PlaylistSummary = z.object({
  id: z.string(),
  name: z.string(),
  owner_handle: z.string(),
  track_count: z.number().int(),
  image_url: nullableString.optional(),
});
export type PlaylistSummary = z.infer<typeof PlaylistSummary>;

// the album routes are not in client-api.json, so nothing checks these two against a baseline;
// they follow backend/src/backend/api/albums/schemas.py (ArtistAlbumListItem, AlbumMetadata)
export const ArtistAlbum = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  track_count: z.number().int(),
  total_plays: z.number().int(),
  image_url: nullableString,
});
export type ArtistAlbum = z.infer<typeof ArtistAlbum>;

export const AlbumMetadata = ArtistAlbum.extend({
  description: nullableString.optional(),
  artist: z.string(),
  artist_handle: z.string(),
});
export type AlbumMetadata = z.infer<typeof AlbumMetadata>;

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

/** `GET /search/` — every kind of result; a kind this client does not know is skipped. */
export function parseSearch(body: Body, onReject?: (error: z.ZodError) => void): SearchResult[] {
  const { results } = z.object({ results: z.array(z.unknown()) }).parse(body);
  const known = new Set(SearchResult.options.map((o) => o.shape.type.value));
  const kinds = results.filter((r) => typeof r === "object" && r !== null && "type" in r && known.has(r.type as never));
  return acceptEach(SearchResult, kinds, onReject);
}

/** `GET /artists/by-handle/{handle}`. */
export function parseArtist(body: Body): Artist {
  return Artist.parse(body);
}

/** `GET /tracks/tags` — a bare list. */
export function parseTags(body: Body, onReject?: (error: z.ZodError) => void): TagWithCount[] {
  return acceptEach(TagWithCount, body, onReject);
}

export type TagTracks = { tag: z.infer<typeof TagDetail>; tracks: Track[] };

/** `GET /tracks/tags/{name}`. */
export function parseTagTracks(body: Body, onReject?: (error: z.ZodError) => void): TagTracks {
  const page = z.object({ tag: TagDetail, tracks: z.array(z.unknown()) }).parse(body);
  return { tag: page.tag, tracks: acceptEach(Track, page.tracks, onReject) };
}

export type PlaylistWithTracks = { playlist: Playlist; tracks: Track[] };

/** `GET /lists/playlists/{id}`. */
export function parsePlaylist(body: Body, onReject?: (error: z.ZodError) => void): PlaylistWithTracks {
  const playlist = Playlist.parse(body);
  const { tracks } = z.object({ tracks: z.array(z.unknown()) }).parse(body);
  return { playlist, tracks: acceptEach(Track, tracks, onReject) };
}

/** `GET /lists/playlists/by-artist/{did}` — a bare list of the playlists an artist shows on their profile. */
export function parsePlaylists(body: Body, onReject?: (error: z.ZodError) => void): PlaylistSummary[] {
  return acceptEach(PlaylistSummary, body, onReject);
}

/** `GET /albums/{handle}`. */
export function parseArtistAlbums(body: Body, onReject?: (error: z.ZodError) => void): ArtistAlbum[] {
  const { albums } = z.object({ albums: z.array(z.unknown()) }).parse(body);
  return acceptEach(ArtistAlbum, albums, onReject);
}

export type AlbumWithTracks = { album: AlbumMetadata; tracks: Track[] };

/** `GET /albums/{handle}/{slug}`. */
export function parseAlbum(body: Body, onReject?: (error: z.ZodError) => void): AlbumWithTracks {
  const page = z.object({ metadata: AlbumMetadata, tracks: z.array(z.unknown()) }).parse(body);
  return { album: page.metadata, tracks: acceptEach(Track, page.tracks, onReject) };
}
