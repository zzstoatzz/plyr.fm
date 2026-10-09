import { useQueryClient } from "@tanstack/react-query";
import type { SearchResult } from "plyr-shared/contract";
import { nextSearchLimit, resultKey, SEARCH_LIMITS, SEARCH_MIN_LENGTH } from "plyr-shared/search";
import { orderTags } from "plyr-shared/tags";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { END_THRESHOLD } from "@/components/MoreFooter";
import { SearchField } from "@/components/SearchField";
import { SearchResultRow } from "@/components/SearchResultRow";
import { TagChips } from "@/components/TagChips";
import { TrackItem } from "@/components/TrackItem";
import { fetchTrack, usePopularTags, useSearch, useTopTracks } from "@/data";
import { useOpen } from "@/nav";
import { usePlayer } from "@/player/PlayerProvider";
import { color, inset } from "@/theme";
import { type } from "@/type";

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export default function Search() {
  const [text, setText] = useState("");
  const query = useDebounced(text, 250);
  const [grown, setGrown] = useState<{ query: string; limit: number }>({ query, limit: SEARCH_LIMITS[0] });
  const limit = grown.query === query ? grown.limit : SEARCH_LIMITS[0];
  const search = useSearch(query, limit);
  const { top } = useSafeAreaInsets();
  const client = useQueryClient();
  const player = usePlayer();
  const open = useOpen();
  const typing = text.trim().length >= SEARCH_MIN_LENGTH;
  const short = query.trim().length < SEARCH_MIN_LENGTH;
  const results = search.data ?? [];
  const more = search.isPlaceholderData ? null : nextSearchLimit(results, limit);

  const choose = async (result: SearchResult) => {
    switch (result.type) {
      case "track": {
        // search hits carry no audio details, so the track is fetched whole before it plays
        const track = await fetchTrack(client, result.id).catch(() => null);
        if (track) player.playList([track], 0);
        return;
      }
      case "artist":
        return open({ artist: result.handle });
      case "album":
        return open({ album: { handle: result.artist_handle, slug: result.slug } });
      case "tag":
        return open({ tag: result.name });
      case "playlist":
        return open({ playlist: result.id });
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <Text style={[type.display, styles.title]} accessibilityRole="header">
        search
      </Text>
      <SearchField value={text} onChange={setText} placeholder="tracks, artists, albums, playlists" />
      {typing ? (
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.results}
          data={short ? [] : results}
          onEndReached={() => more && setGrown({ query, limit: more })}
          onEndReachedThreshold={END_THRESHOLD}
          ListFooterComponent={
            more || (search.isFetching && results.length > 0) ? (
              <ActivityIndicator style={styles.more} color={color.muted} accessibilityLabel="loading more" />
            ) : null
          }
          keyExtractor={resultKey}
          renderItem={({ item }) => (
            <SearchResultRow result={item} active={item.type === "track" && player.track?.id === item.id} onPress={() => void choose(item)} />
          )}
          ListEmptyComponent={
            short || search.isPending ? (
              <ActivityIndicator style={styles.state} color={color.muted} />
            ) : (
              <View style={styles.state}>
                <Text style={[type.body, { color: color.muted, textAlign: "center" }]}>
                  {search.isError ? "search didn’t go through. try again." : `no results for “${query.trim()}”`}
                </Text>
              </View>
            )
          }
        />
      ) : (
        <Suggestions />
      )}
    </View>
  );
}

/** Before anything is typed: popular tags to wander into, and what people are playing this week. */
function Suggestions() {
  const tags = usePopularTags();
  const week = useTopTracks("week");
  const open = useOpen();
  const chips = useMemo(() => orderTags(tags.data ?? [], []), [tags.data]);
  const tracks = week.data ?? [];
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
      <Text style={[type.secondary, styles.hint]}>search across tracks, artists, albums, tags and playlists.</Text>
      {chips.length > 0 ? (
        <View style={styles.section}>
          <Text style={[type.section, styles.heading]} accessibilityRole="header">
            popular tags
          </Text>
          <TagChips tags={chips} onPress={(name) => open({ tag: name })} wrap />
        </View>
      ) : null}
      {tracks.length > 0 ? (
        <View style={styles.section}>
          <Text style={[type.section, styles.heading]} accessibilityRole="header">
            top this week
          </Text>
          {tracks.map((t, i) => (
            <TrackItem key={t.id} tracks={tracks} index={i} label="top this week" />
          ))}
        </View>
      ) : null}
      {tags.isPending || week.isPending ? <ActivityIndicator style={styles.state} color={color.muted} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  title: { color: color.ink, paddingHorizontal: inset, paddingTop: 4, paddingBottom: 8 },
  results: { paddingTop: 8 },
  more: { padding: 20 },
  hint: { color: color.muted, paddingHorizontal: inset, paddingTop: 12, paddingBottom: 8 },
  section: { paddingTop: 12, gap: 6 },
  heading: { color: color.ink, paddingHorizontal: inset },
  state: { padding: 40 },
});
