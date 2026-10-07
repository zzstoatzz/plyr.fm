import { queryOptions, useInfiniteQuery, useQuery, type QueryClient } from "@tanstack/react-query";
import { parseAudioUrl, parseTrack, parseTrackList, parseTrackPage, parseTrackSearch, type Track } from "plyr-shared/contract";
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

export function useLatestTracks() {
  return useInfiniteQuery({
    queryKey: ["latest"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getJSON(
        pageParam ? `/tracks/?cursor=${encodeURIComponent(pageParam)}` : "/tracks/",
        (b) => parseTrackPage(b, report("track")),
        signal,
      ),
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : null),
  });
}

export function useTrackSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["search", q],
    enabled: q.length >= 2,
    queryFn: ({ signal }) =>
      getJSON(`/search/?type=tracks&limit=30&q=${encodeURIComponent(q)}`, (b) => parseTrackSearch(b, report("search result")), signal),
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
