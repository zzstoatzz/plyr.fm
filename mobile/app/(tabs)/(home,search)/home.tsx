import { useQueryClient } from "@tanstack/react-query";
import { orderTags } from "plyr-shared/tags";
import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { END_THRESHOLD, loadMore, MoreFooter } from "@/components/MoreFooter";
import { TagChips } from "@/components/TagChips";
import { TopTracks } from "@/components/TopTracks";
import { TrackItem } from "@/components/TrackItem";
import { useLatestTracks, usePopularTags } from "@/data";
import { haptic } from "@/haptics";
import { useSettings } from "@/settings";
import { tabBarScroll } from "@/tabBar";
import { color, inset } from "@/theme";
import { type } from "@/type";

export default function Home() {
  const [tags, setTags] = useState<string[]>([]);
  const settings = useSettings();
  const latest = useLatestTracks(tags, settings);
  const popular = usePopularTags();
  const client = useQueryClient();
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  const [onScroll] = useState(tabBarScroll);
  const tracks = useMemo(() => latest.data?.pages.flatMap((p) => p.tracks) ?? [], [latest.data]);
  const chips = useMemo(() => orderTags((popular.data ?? []).filter((tag) => !settings.hidden_tags.includes(tag.name)), tags), [popular.data, tags, settings.hidden_tags]);

  const toggle = (name: string) => {
    haptic.selection();
    setTags((now) => (now.includes(name) ? now.filter((t) => t !== name) : [...now, name]));
  };

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["top"] });
    void client.invalidateQueries({ queryKey: ["tags"] });
    void latest.refetch();
  };

  return (
    <View style={[styles.screen, { paddingTop: top }]}>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={tracks}
        onScroll={onScroll}
        scrollEventThrottle={32}
        keyExtractor={(t) => String(t.id)}
        refreshControl={<RefreshControl refreshing={latest.isRefetching && !latest.isFetchingNextPage} onRefresh={refresh} />}
        onEndReached={() => loadMore(latest)}
        onEndReachedThreshold={END_THRESHOLD}
        ListHeaderComponent={
          <>
            <View style={styles.top}>
              <Text style={[type.display, styles.title]} accessibilityRole="header">
                plyr.fm
              </Text>
              <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="settings" hitSlop={10} style={styles.gear}>
                <SymbolView name="gearshape" size={22} tintColor={color.muted} />
              </Pressable>
            </View>
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
        ListFooterComponent={<MoreFooter pages={latest} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: inset },
  gear: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  title: { color: color.ink, paddingHorizontal: inset, paddingTop: 4, paddingBottom: 8 },
  heading: { color: color.ink, paddingHorizontal: inset, paddingTop: 8, paddingBottom: 4 },
  chips: { paddingBottom: 6 },
  state: { padding: 40 },
});
