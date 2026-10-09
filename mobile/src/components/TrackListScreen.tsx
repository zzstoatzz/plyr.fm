import { Stack } from "expo-router";
import type { Track } from "plyr-shared/contract";
import { useState, type ReactElement } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { tabBarScroll } from "@/tabBar";
import { color } from "@/theme";
import { type } from "@/type";
import { END_THRESHOLD, loadMore, MoreFooter, type Paged } from "./MoreFooter";
import { TrackItem, type TrackLine } from "./TrackItem";

type Props = {
  title: string;
  header?: ReactElement | null;
  tracks: readonly Track[];
  pending: boolean;
  error: boolean;
  empty: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  pages?: Paged;
  line?: TrackLine;
  /** What a track tapped here continues as: "next from: label". */
  label?: string | null;
};

/** A detail screen that is mostly a track list: artist, album, tag, playlist. */
export function TrackListScreen({ title, header, tracks, pending, error, empty, refreshing = false, onRefresh, pages, line, label }: Props) {
  const [onScroll] = useState(tabBarScroll);
  return (
    <>
      <Stack.Screen options={{ title }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={tracks}
        onScroll={onScroll}
        scrollEventThrottle={32}
        keyExtractor={(t) => String(t.id)}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
        onEndReached={pages ? () => loadMore(pages) : undefined}
        onEndReachedThreshold={END_THRESHOLD}
        ListHeaderComponent={header}
        renderItem={({ index }) => <TrackItem tracks={tracks} index={index} line={line} label={label} />}
        ListEmptyComponent={
          pending ? (
            <ActivityIndicator style={styles.state} color={color.muted} />
          ) : (
            <View style={styles.state}>
              <Text style={[type.body, { color: color.muted, textAlign: "center" }]}>{error ? "couldn’t reach plyr.fm. pull to try again." : empty}</Text>
            </View>
          )
        }
        ListFooterComponent={pages ? <MoreFooter pages={pages} /> : null}
      />
    </>
  );
}

const styles = StyleSheet.create({
  state: { padding: 40 },
});
