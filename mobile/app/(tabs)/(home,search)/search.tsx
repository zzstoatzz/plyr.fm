import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import type { SearchResult } from "plyr-shared/contract";
import { resultKey, SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from "plyr-shared/search";
import { orderTags } from "plyr-shared/tags";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
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
  const search = useSearch(query);
  const client = useQueryClient();
  const player = usePlayer();
  const open = useOpen();
  const typing = text.trim().length >= SEARCH_MIN_LENGTH;
  const short = query.trim().length < SEARCH_MIN_LENGTH;
  const results = search.data ?? [];

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
    <>
      <Stack.Screen
        options={{
          title: "search",
          headerSearchBarOptions: {
            placeholder: "tracks, artists, albums, playlists",
            autoCapitalize: "none",
            hideWhenScrolling: false,
            onChangeText: (e) => setText(e.nativeEvent.text.slice(0, SEARCH_MAX_LENGTH)),
          },
        }}
      />
      {typing ? (
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          data={short ? [] : results}
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
    </>
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
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
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
            <TrackItem key={t.id} tracks={tracks} index={i} />
          ))}
        </View>
      ) : null}
      {tags.isPending || week.isPending ? <ActivityIndicator style={styles.state} color={color.muted} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hint: { color: color.muted, paddingHorizontal: inset, paddingTop: 4, paddingBottom: 8 },
  section: { paddingTop: 12, gap: 6 },
  heading: { color: color.ink, paddingHorizontal: inset },
  state: { padding: 40 },
});
