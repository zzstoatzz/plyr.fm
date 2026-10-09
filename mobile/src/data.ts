import { queryOptions, useInfiniteQuery, useQuery, type QueryClient } from "@tanstack/react-query";
import {
  parseAlbum,
  parseArtist,
  parseArtistAlbums,
  parseAudioUrl,
  parsePlaylist,
  parsePlaylists,
  parseSearch,
  parseTagTracks,
  parseTags,
  parseTrack,
  parseTrackList,
  parseTrackPage,
  type Track,
} from "plyr-shared/contract";
import { SEARCH_MIN_LENGTH } from "plyr-shared/search";
import { TAG_FILTER_LIMIT } from "plyr-shared/tags";
import { topTracksQuery, type TopPeriod } from "plyr-shared/top";
import { getJSON } from "./api";

const report = (what: string) => (error: unknown) => console.warn(`dropped a malformed ${what}`, error);

export const topTracks = (period: TopPeriod) =>
  queryOptions({
    queryKey: ["top", period],
    queryFn: ({ signal }) => getJSON(`/tracks/top?${topTracksQuery(period)}`, (b) => parseTrackList(b, report("top track")), signal),
  });

export function useTopTracks(period: TopPeriod) {
  return useQuery(topTracks(period));
}

function tracksPath(params: { tags?: readonly string[]; artistDid?: string; cursor: string | null }): string {
  const pairs: [string, string][] = (params.tags ?? []).map((tag) => ["tags", tag]);
  if (params.artistDid) pairs.push(["artist_did", params.artistDid]);
  if (params.cursor) pairs.push(["cursor", params.cursor]);
  const qs = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return qs ? `/tracks/?${qs}` : "/tracks/";
}

/** The discovery feed, newest first; `tags` narrows it to tracks carrying any of them. */
export function useLatestTracks(tags: readonly string[] = []) {
  return useInfiniteQuery({
    queryKey: ["latest", [...tags].sort()],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => getJSON(tracksPath({ tags, cursor: pageParam }), (b) => parseTrackPage(b, report("track")), signal),
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : null),
  });
}

export function useArtistTracks(did: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["artist-tracks", did],
    enabled: !!did,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getJSON(tracksPath({ artistDid: did, cursor: pageParam }), (b) => parseTrackPage(b, report("track")), signal),
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : null),
  });
}

export function usePopularTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: ({ signal }) => getJSON(`/tracks/tags?limit=${TAG_FILTER_LIMIT}`, (b) => parseTags(b, report("tag")), signal),
    staleTime: 10 * 60_000,
  });
}

export function useArtist(handle: string) {
  return useQuery({
    queryKey: ["artist", handle],
    queryFn: ({ signal }) => getJSON(`/artists/by-handle/${encodeURIComponent(handle)}`, parseArtist, signal),
  });
}

export function useArtistAlbums(handle: string) {
  return useQuery({
    queryKey: ["artist-albums", handle],
    queryFn: ({ signal }) => getJSON(`/albums/${encodeURIComponent(handle)}`, (b) => parseArtistAlbums(b, report("album")), signal),
  });
}

/** The playlists an artist shows on their profile. */
export function useArtistPlaylists(did: string | undefined) {
  return useQuery({
    queryKey: ["artist-playlists", did],
    enabled: !!did,
    queryFn: ({ signal }) =>
      getJSON(`/lists/playlists/by-artist/${encodeURIComponent(did ?? "")}`, (b) => parsePlaylists(b, report("playlist")), signal),
  });
}

export function useAlbum(handle: string, slug: string) {
  return useQuery({
    queryKey: ["album", handle, slug],
    queryFn: ({ signal }) =>
      getJSON(`/albums/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`, (b) => parseAlbum(b, report("track")), signal),
  });
}

export function useTagTracks(name: string) {
  return useQuery({
    queryKey: ["tag", name],
    queryFn: ({ signal }) => getJSON(`/tracks/tags/${encodeURIComponent(name)}`, (b) => parseTagTracks(b, report("track")), signal),
  });
}

export function usePlaylist(id: string) {
  return useQuery({
    queryKey: ["playlist", id],
    queryFn: ({ signal }) => getJSON(`/lists/playlists/${encodeURIComponent(id)}`, (b) => parsePlaylist(b, report("track")), signal),
  });
}

export function useSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["search", q],
    enabled: q.length >= SEARCH_MIN_LENGTH,
    queryFn: ({ signal }) => getJSON(`/search/?limit=10&q=${encodeURIComponent(q)}`, (b) => parseSearch(b, report("search result")), signal),
    placeholderData: (previous) => previous,
  });
}

export function fetchTrack(client: QueryClient, id: number): Promise<Track> {
  return client.fetchQuery({ queryKey: ["track", id], queryFn: ({ signal }) => getJSON(`/tracks/${id}`, parseTrack, signal) });
}

/** The direct, range-capable URL for a file; presigned URLs expire, so this is cached briefly. */
export function fetchAudioUrl(client: QueryClient, fileId: string): Promise<string> {
  return client
    .fetchQuery({
      queryKey: ["audio-url", fileId],
      queryFn: ({ signal }) => getJSON(`/audio/${encodeURIComponent(fileId)}/url`, parseAudioUrl, signal),
      staleTime: 5 * 60_000,
    })
    .then((audio) => audio.url);
}
