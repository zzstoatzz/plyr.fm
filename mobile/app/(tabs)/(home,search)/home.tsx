import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { orderTags } from "plyr-shared/tags";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { TagChips } from "@/components/TagChips";
import { TopTracks } from "@/components/TopTracks";
import { TrackItem } from "@/components/TrackItem";
import { useLatestTracks, usePopularTags } from "@/data";
import { color, inset } from "@/theme";
import { type } from "@/type";

export default function Home() {
  const [tags, setTags] = useState<string[]>([]);
  const latest = useLatestTracks(tags);
  const popular = usePopularTags();
  const client = useQueryClient();
  const tracks = useMemo(() => latest.data?.pages.flatMap((p) => p.tracks) ?? [], [latest.data]);
  const chips = useMemo(() => orderTags(popular.data ?? [], tags), [popular.data, tags]);

  const toggle = (name: string) => setTags((now) => (now.includes(name) ? now.filter((t) => t !== name) : [...now, name]));

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["top"] });
    void client.invalidateQueries({ queryKey: ["tags"] });
    void latest.refetch();
  };

  return (
    <>
      <Stack.Screen options={{ title: "plyr.fm" }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={tracks}
        keyExtractor={(t) => String(t.id)}
        refreshControl={<RefreshControl refreshing={latest.isRefetching && !latest.isFetchingNextPage} onRefresh={refresh} />}
        onEndReached={() => latest.hasNextPage && !latest.isFetchingNextPage && void latest.fetchNextPage()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={
          <>
            <TopTracks />
            <Text style={[type.section, styles.heading]} accessibilityRole="header">
              tracks
            </Text>
            {chips.length > 0 ? (
              <View style={styles.chips}>
                <TagChips tags={chips} selected={tags} onPress={toggle} onClear={() => setTags([])} />
              </View>
            ) : null}
          </>
        }
        renderItem={({ index }) => <TrackItem tracks={tracks} index={index} label={tags.length ? tags.map((t) => `#${t}`).join(" ") : "latest tracks"} />}
        ListEmptyComponent={
          latest.isPending ? (
            <ActivityIndicator style={styles.state} color={color.muted} />
          ) : (
            <View style={styles.state}>
              <Text style={[type.body, { color: color.muted, textAlign: "center" }]}>
                {latest.isError ? "couldn’t reach plyr.fm. pull to try again." : tags.length ? "no tracks match these tags." : "no tracks yet."}
              </Text>
            </View>
          )
        }
        ListFooterComponent={latest.isFetchingNextPage ? <ActivityIndicator style={styles.more} color={color.muted} /> : null}
      />
    </>
  );
}

const styles = StyleSheet.create({
  heading: { color: color.ink, paddingHorizontal: inset, paddingTop: 8, paddingBottom: 4 },
  chips: { paddingBottom: 6 },
  state: { padding: 40 },
  more: { padding: 20 },
});
